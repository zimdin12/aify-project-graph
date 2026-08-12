// PARSING VITEST'S SUMMARY LINES AS A GRAMMAR, NOT AS TOKEN LOOKUPS.
//
// ⛔ The version this replaces did `Number(line.match(/(\d+) failed/)?.[1] ?? -1)` per category.
// **Vitest OMITS zero categories**, so an ordinary all-green run — `Test Files  240 passed
// (240)` — has no `failed` token, yielding -1, and the nonnegative gate added alongside it then
// refused. My fix for "unparseable output exits 0" made ORDINARY SUCCESS impossible to emit.
// graph-senior-dev-hermes found it from the source and the summary shape; it had never fired
// locally because every run since had refused earlier at the dirty-tree gate.
//
// ★ A missing optional category means ZERO **only once the complete line is recognised**.
// Inferring 0 from a failed token match is the original defect wearing different clothes:
// absence read as a value rather than as "the parse did not happen".
//
// EXTRACTED so it can be called at all — it previously lived inside suite-receipt.mjs, which
// runs the entire suite on import. That is the second time in one day that an unfalsifiable
// helper was unfalsifiable because it could not be imported.
const SUMMARY = /^\s*(Test Files|Tests)\s+(.+?)\s*\((\d+)\)\s*$/;

export function parseSummaryLine(label, text) {
  const line = String(text ?? '').split('\n').find((l) => {
    const m = SUMMARY.exec(l);
    return m && m[1] === label;
  });
  if (!line) return { recognised: false, reason: `no "${label}" summary line matching the reporter grammar` };

  const [, , body, totalStr] = SUMMARY.exec(line);
  const cats = {};
  for (const seg of body.split('|')) {
    const m = /^\s*(\d+)\s+([a-z]+)\s*$/.exec(seg);
    if (!m) return { recognised: false, reason: `unparsed segment ${JSON.stringify(seg.trim())} in "${label}"` };
    if (Object.prototype.hasOwnProperty.call(cats, m[2])) {
      return { recognised: false, reason: `duplicate category "${m[2]}" in "${label}"` };
    }
    cats[m[2]] = Number(m[1]);
  }

  const total = Number(totalStr);
  const sum = Object.values(cats).reduce((a, b) => a + b, 0);
  // ★ The parenthesised figure is the reporter's OWN population statement. If the categories do
  // not sum to it, the line was understood incompletely — and an incompletely understood line
  // is not a number to publish, however plausible its parts look.
  if (sum !== total) {
    return { recognised: false, reason: `"${label}" categories ${JSON.stringify(cats)} sum to ${sum}, reporter says ${total}` };
  }
  return { recognised: true, line, total, passed: 0, failed: 0, skipped: 0, todo: 0, ...cats };
}
