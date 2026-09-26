// THE JOIN KEY BETWEEN AN EMITTED REF AND A RECORDED ONE — in one place, because two audits got it
// wrong independently and one of them published the wrong number.
//
// ⭐ WHY THIS MODULE EXISTS. An emitted ref names its target as a STRING. The graph stores the target
// as a NODE. Deciding whether they are the same thing is the entire difficulty of every conservation
// check, and it has now produced three measured mistakes:
//
//   1. population from `SELECT DISTINCT file_path FROM nodes`      -> 65.20% (phantom files)
//   2. a line in the key, against edges deduplicated without one   -> 68.59% (phantom lines)
//   3. matching an emitted target ONLY against `nodes.label`       -> 90.19% (phantom IMPORTS)
//
// Mistake 3 is the one this module fixes, and it is the subtlest because it is relation-specific. The
// javascript extractor emits an import's target as a REPO-RELATIVE PATH:
//
//   emitted  { relation: 'IMPORTS', target: 'src/middle.js' }
//   recorded  node { label: 'middle.js', file_path: 'src/middle.js', type: 'File' }
//
// A label-only match therefore fails for EVERY import. In the point-in-time direction that reported
// 4,488 phantom losses out of 4,514 — 99.4% of the headline. In the across-a-run direction it does the
// opposite and worse: a genuinely LOST import still fails to match, so it is classified as "the source
// stopped referencing it" and the check goes QUIET on the exact relation the incremental edge loss
// primarily destroyed. Measured, not reasoned: a planted drop on a surviving IMPORTS edge was reported
// as REMOVED_AT_SOURCE by ARM C of `audit-ref-conservation-across-run.mjs` before this fix.
//
// ⛔ AND THE RULE THAT KEEPS IT FIXED: the address forms are DERIVED FROM THE NODE ROW, never listed
// per relation. A `switch (relation)` here would be a list someone must remember to extend the next
// time an extractor emits a new target shape, which is a defect with a delay on it.
//
// ⚠ PRE-REGISTERED LIMIT, before the corrected figure existed: widening the recorded set can only ever
// move conservation UP. It cannot be used as evidence that conservation is good — only as evidence that
// a previously reported loss was an artifact. A key that matched everything would read 100%, so the
// figure is meaningless without the arms in the across-run audit, which prove the key can still report
// a planted loss. A widened key needs a fresh refutation, not a better number.

// The two-field separator is a NUL so no path or symbol name can forge a key boundary.
export const keyOf = (file, relation, target) => `${file}\u0000${relation}\u0000${target}`;

export const describeKey = (key) => {
  const [file, relation, target] = key.split('\u0000');
  return `${file}   ${relation} -> ${target}`;
};

// The name an emitted ref points AT. Extraction gives a symbolic `target`, or an already-resolved
// `to_id` with its `to_label`; callers compare whichever it gave against every form of the node.
export function refTargetName(ref) {
  if (ref.target) return String(ref.target);
  if (ref.to_label) return String(ref.to_label);
  if (ref.to_id) return String(ref.to_id);
  return '';
}

// ⭐ EVERY STRING THAT LEGITIMATELY ADDRESSES ONE NODE, derived from the row itself.
//   label                     a symbol ref: `middle`
//   file_path                 a module ref: `src/middle.js`          (the form mistake 3 missed)
//   file_path + '.' + label   a per-symbol import: `src/middle.js.middle`
//   id                        a ref that arrived already resolved
// A node contributes only the forms its own fields support, so nothing here assumes a relation.
export function nodeAddressForms({ id, label, file_path: filePath }) {
  const forms = [];
  if (label) forms.push(String(label));
  if (filePath) forms.push(String(filePath));
  if (filePath && label) forms.push(`${filePath}.${label}`);
  if (id) forms.push(String(id));
  return forms;
}

// ⭐ IS THIS EMITTED REF THE PER-BINDING REFINEMENT OF AN IMPORT THAT *WAS* RECORDED?
//
// The javascript extractor emits TWO kinds of IMPORTS ref for `import { a, b } from './m.js'`: one for
// the MODULE (`src/m.js`) and one per BINDING (`src/m.js.a`, `src/m.js.b`). The ingest path records the
// module edge to the File node and nothing for the bindings — no edge and no `unresolved_refs` row.
//
// Measured on this repository at cd7ad74e: 2,679 of 2,690 reported losses are this one shape. Folding
// them into a loss headline would be the third way of getting the same number wrong, so they are
// reported as their own class. ⚠ AND THEIR STATUS IS GENUINELY UNRESOLVED: the binding information is
// demonstrably consumed elsewhere (a CALLS ref carries an `importMap` built from it), which argues it
// is an intermediate rather than an intended edge. This function does NOT decide that question — it
// only separates the class so the residue is readable.
//
// ⛔ DERIVED, NOT PATTERN-MATCHED. No extension list and no regex on `.js`: the test is whether
// dropping the final dot-segment yields a target the graph DID record as an import from the same file.
// If it did, the module reference was conserved and only the per-binding refinement is missing. A
// regex would also match a genuinely lost `src/a.b` and quietly excuse it.
export function isRecordedModuleWithUnrecordedBinding({ recorded, sourceFile, relation, target }) {
  if (relation !== 'IMPORTS') return false;
  const cut = target.lastIndexOf('.');
  if (cut <= 0) return false;
  return recorded.has(keyOf(sourceFile, relation, target.slice(0, cut)));
}

// The set of (source_file, relation, target) keys the graph RECORDED — as a resolved edge, or as an
// `unresolved_refs` row, which is a refusal and therefore not a loss. One edge yields one key per
// address form of its target node.
//
// ⛔ THE KEY CARRIES NO LINE. `edges` is unique on (from_id, to_id, relation): measured on this
// repository's graph, 36,635 rows and 36,635 distinct triples, with a maximum of ONE distinct
// source_line per triple. A symbol called from twenty lines of one file keeps one row and one line, so
// a line-level key reports nineteen phantom losses. That was mistake 2.
export function recordedKeys(db) {
  const keys = new Set();
  const files = new Set();
  for (const row of db.all(
    `SELECT e.source_file AS sourceFile, e.relation AS relation,
            n.id AS id, n.label AS label, n.file_path AS file_path
     FROM edges e JOIN nodes n ON n.id = e.to_id`,
  )) {
    for (const form of nodeAddressForms(row)) keys.add(keyOf(row.sourceFile, row.relation, form));
    files.add(row.sourceFile);
  }
  const fromEdges = keys.size;
  for (const row of db.all('SELECT source_file, relation, target, to_id FROM unresolved_refs')) {
    keys.add(keyOf(row.source_file, row.relation, row.target ?? row.to_id ?? ''));
    files.add(row.source_file);
  }
  return { keys, files, fromEdges };
}
