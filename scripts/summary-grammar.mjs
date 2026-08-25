// PARSING VITEST'S SUMMARY LINES AS A GRAMMAR, NOT AS TOKEN LOOKUPS.
//
// ⛔ The version this replaces did `Number(line.match(/(\d+) failed/)?.[1] ?? -1)` per category.
// **Vitest OMITS zero categories**, so an ordinary all-green run — `Test Files  240 passed
// (240)` — has no `failed` token, yielding -1, and the nonnegative gate added alongside it then
// refused. My fix for "unparseable output exits 0" made ORDINARY SUCCESS impossible to emit.
// review, hermes session found it from the source and the summary shape; it had never fired
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

// ⛔ CLOSED CATEGORY SETS, PER LABEL. The first version accepted any `[a-z]+`, summed it into
// the reporter total, and returned it by spread — while suite-receipt projected only
// passed/failed/skipped/todo. review, hermes session executed the consequence:
//
//   parseSummaryLine('Tests', ' Tests  1 bananas (1)')
//     -> recognised:true, total:1, passed:0, failed:0, skipped:0, todo:0, bananas:1
//
// The grammar declared the line COMPLETE while the receipt could publish zero known outcomes
// of a population of one. That is the same unknown-population laundering the grammar existed
// to prevent, one layer in — an open vocabulary is not a grammar, it is a shape check.
//
// ⇒ A category outside the label's measured vocabulary means the reporter changed or the line
// was misread. Either way it is REFUSED, not silently carried.
const CATEGORIES = {
  'Test Files': ['passed', 'failed', 'skipped'],
  Tests: ['passed', 'failed', 'skipped', 'todo'],
};

export function parseSummaryLine(label, text) {
  const allowed = CATEGORIES[label];
  if (!allowed) return { recognised: false, reason: `unknown summary label ${JSON.stringify(label)}` };
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
    if (!allowed.includes(m[2])) {
      return { recognised: false, reason: `unknown category "${m[2]}" for "${label}" — expected one of ${allowed.join('/')}` };
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
  const out = { recognised: true, line, total, passed: 0, failed: 0, skipped: 0, todo: 0, ...cats };
  // ★ THE PROJECTED FIELDS THEMSELVES MUST SUM TO THE TOTAL. Checking the parsed categories
  // was not enough: what the consumer publishes is this projection, so the projection is what
  // has to reconcile. Any future category that parses but is not projected fails here rather
  // than quietly shrinking the reported population.
  const projected = out.passed + out.failed + out.skipped + out.todo;
  if (projected !== total) {
    return { recognised: false, reason: `"${label}" projected fields sum to ${projected}, reporter says ${total}` };
  }
  return out;
}
