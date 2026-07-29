// Locate the column of a DECLARED NAME so LSP requests land ON THE IDENTIFIER.
//
// This matters more than it looks. Some servers (clangd 18.x) return flat
// SymbolInformation[] whose range covers the whole declaration and carries NO
// identifier column, so we have to find the name in the source. Every downstream
// request — definition, references, prepareCallHierarchy — is issued at that
// position, and the server answers about whatever token sits under it.
//
// The original implementation was `declLine.indexOf(leafName)`: the first
// SUBSTRING hit. On `Builder Builder::build()` looking for `build`, that matches
// inside the return type `Builder` at column 0, so every request landed on a TYPE
// instead of the method. One line, three separate field symptoms:
//   - code_intel_hierarchy returned zero (a type has no call hierarchy);
//   - type references surfaced as CALLS [lsp✓] (they were references TO THE TYPE);
//   - verbs disagreed about which line a symbol was on.
//
// Shared by the clangd provider and the generic multi-language collector, which
// each had their own copy of the same defect.

// Returns the column of `leafName` in `declLine`, or -1 when it cannot be
// located. -1 is meaningful: the caller must be able to report a GUESSED position
// rather than present a column-0 answer as ground truth.
export function identifierColumn(declLine, leafName) {
  if (!declLine || !leafName) return -1;
  const escaped = leafName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Whole-word only: `build` must not match inside `Builder`.
  const re = new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'gu');
  const hits = [];
  let m;
  while ((m = re.exec(declLine)) !== null) hits.push(m.index);
  if (hits.length === 0) return -1;
  if (hits.length === 1) return hits[0];
  // Several whole-word hits — a constructor `Foo::Foo(Foo other)`, a parameter
  // sharing the method name, `def x(x)`. Prefer the declarator itself: qualified
  // by `::` or `.` immediately before, else immediately followed by `(` or `<`.
  const qualified = hits.find((i) => /(?:::|\.)$/u.test(declLine.slice(0, i)));
  if (qualified !== undefined) return qualified;
  const declarator = hits.find((i) => /^\s*[(<]/u.test(declLine.slice(i + leafName.length)));
  if (declarator !== undefined) return declarator;
  return hits[0];
}

// A signature routinely wraps, putting the name on a line below the one the
// range starts on:
//   template <typename T>
//   std::unique_ptr<Widget>
//   WidgetFactory::create(const Spec& spec)
// Search a small window forward rather than giving up at the first line.
const IDENTIFIER_SEARCH_LINES = 3;

export function findIdentifierPosition(lines, startLine, leafName) {
  for (let offset = 0; offset < IDENTIFIER_SEARCH_LINES; offset += 1) {
    const col = identifierColumn(lines?.[startLine + offset] ?? '', leafName);
    if (col >= 0) return { line: startLine + offset, character: col, guessed: false };
  }
  // Unfindable. Column 0 keeps the LINE correct, which still beats (0,0), but the
  // caller must know this position was guessed.
  return { line: startLine, character: 0, guessed: true };
}

// Split a qualified name to its leaf, covering `::` (C++), `.` (TS/Python), and
// `#` (some servers' member separator).
export function leafNameOf(qname) {
  return String(qname || '').split(/::|\.|#/u).pop();
}
