// Parameter-list identity for symbols that share a qualified name.
//
// WHY THIS IS NOT PART OF `canonicalSymbolKey`'s FILE: this is a pure text normalizer — signature
// in, canonical parameter text out, no rows, no database, no graph concepts. Symbol resolution is
// a different responsibility, and `symbol_lookup.js` was already at 425 lines.
//
// ⛔ THE WHOLE SIGNATURE CANNOT BE USED AS IDENTITY, AND THAT IS MEASURED, NOT ASSUMED.
// On `tests/fixtures/identity-callers` a C++ declaration and its definition carry DIFFERENT
// signatures, because the definition records the written qualifier:
//     def   src/widgets.cpp:4   signature="Widget::render()"
//     decl  src/widgets.h:8     signature="render()"
// Keying on the full signature would re-fork the decl/def pair that `6372aae` merged. The
// divergence is confined to the prefix BEFORE the parenthesis, so the parenthesised parameter list
// is the part that identifies the symbol without carrying the divergence.
//
// ⛔ PARAMETER NAMES ARE NOT IDENTITY EITHER. C++ permits a declaration and a definition to name
// the same parameter differently (`int clamp(int value);` / `int clamp(int v) {...}`). Keeping the
// names would fork that pair, so names are stripped and TYPES are what remain.

// The C++ builtin type keywords. This is a CLOSED set fixed by the language standard, not a list of
// our own values that drifts as the code changes — so it is a constant, not the kind of hardcoded
// allowlist that rots. It exists for one specific failure: in an UNNAMED parameter like
// `unsigned int`, the trailing word is part of the TYPE. Stripping it would turn `f(unsigned int)`
// into `unsigned`, so a declaration written `f(unsigned int)` and a definition written
// `f(unsigned int x)` would normalize differently and fork — exactly the regression this whole
// approach exists to avoid.
const BUILTIN_TYPE_WORDS = new Set([
  'void', 'bool', 'char', 'char8_t', 'char16_t', 'char32_t', 'wchar_t',
  'short', 'int', 'long', 'signed', 'unsigned', 'float', 'double', 'auto',
  'size_t', 'ssize_t', 'ptrdiff_t', 'nullptr_t',
]);

const TRAILING_IDENTIFIER_RE = /[A-Za-z_][A-Za-z0-9_]*$/;

// Split on commas that are NOT inside template arguments, nested parentheses or array bounds:
// `std::map<int, string> m` is ONE parameter, and a naive `split(',')` reads it as two.
function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '<' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '>' || ch === ')' || ch === ']') depth -= 1;
    else if (ch === ',' && depth <= 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

// One parameter -> its type text. Default arguments are dropped: a declaration may carry
// `int flags = 0` where the definition writes `int flags`, and that difference is not identity.
function parameterType(part) {
  const withoutDefault = part.split('=')[0];
  const collapsed = withoutDefault.replace(/\s+/g, ' ').trim();
  if (collapsed === '') return '';

  const match = collapsed.match(TRAILING_IDENTIFIER_RE);
  if (!match) return collapsed; // ends in `&`, `*`, `>` … nothing name-shaped to remove

  const name = match[0];
  const remainder = collapsed.slice(0, collapsed.length - name.length).trim();
  // Guards, both fail-closed (keep the text) rather than risking a wrong strip:
  //   - nothing would be left  -> the word IS the type (`int`)
  //   - the word is a builtin  -> it is the tail of an unnamed type (`unsigned int`)
  if (remainder === '' || BUILTIN_TYPE_WORDS.has(name)) return collapsed;
  return remainder;
}

/**
 * Canonical parameter list for a signature, or `null` when the signature carries none.
 *
 * ⛔ `null` MUST CONTRIBUTE NOTHING TO A KEY. A symbol with no recorded signature has to keep
 * grouping exactly as it does today; if absence became a key component, every unsignatured symbol
 * would form its own group and the change would fork far more than it fixes.
 */
export function normalizedParamList(signature) {
  if (typeof signature !== 'string') return null;
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open < 0 || close <= open) return null;

  const inner = signature.slice(open + 1, close).trim();
  if (inner === '') return '()';

  const types = splitTopLevelCommas(inner).map(parameterType).filter((t) => t !== '');
  if (types.length === 0) return '()';
  return `(${types.join(',')})`;
}
