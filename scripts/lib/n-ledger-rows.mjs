// THE LEDGER'S ROW FORMAT, AS PURE FUNCTIONS.
//
// Separated from `scripts/n-ledger.mjs` so a test can exercise the parsing without running the
// measurement: importing the entry point would spawn the counter over the whole transcript corpus.

/** Column order is the file format. Appending a column is safe; reordering rewrites history. */
export const COLUMNS = Object.freeze([
  'readAtIso', 'n', 'gateN', 'movement', 'verdictAllowed',
  'controlPositive', 'controlNegative', 'population',
  'excludedOlder', 'excludedUndated', 'excludedInstructed', 'classifierDisagreements',
  'instrumentSha',
]);

export const HEADER = `${COLUMNS.join('\t')}\n`;

/**
 * Whether a reading earns a row.
 *
 * ⛔ WHY THIS IS NOT "ALWAYS", 2026-09-05. The first version appended on every run. The loop that
 * runs it reads n every cycle and mostly finds it unchanged, so each idle tick left a modified file
 * in the working tree — and `scripts/run-suite.mjs` REFUSES on a dirty tree. An instrument built to
 * make the gate readable would have blocked the suite that guards the gate.
 *
 * ⭐ SO A READING THAT FOUND NOTHING NEW WRITES NOTHING. The ledger records the values n has taken
 * and when it first took each one; the absence of a later row means every read since agreed.
 *
 * ⭐ AND `shrank` ALWAYS WRITES. A drop is the one movement that must survive in the file even
 * though it is the one a tidy-minded filter would be most tempted to treat as noise.
 */
export function shouldAppendRow(movement) {
  return movement !== 'unchanged';
}

/** One row, in column order. Every column is written, so a short row is a corrupt row. */
export function formatRow(row) {
  const missing = COLUMNS.filter((c) => row[c] === undefined || row[c] === null);
  if (missing.length > 0) {
    throw new TypeError(`formatRow: missing column(s) ${missing.join(', ')} — a partial row is not a reading`);
  }
  return `${COLUMNS.map((c) => String(row[c])).join('\t')}\n`;
}

/**
 * The last recorded n, or null when the ledger holds no readings yet.
 *
 * ⛔ RETURNS null RATHER THAN 0 FOR AN EMPTY LEDGER. Zero would make the first real reading look
 * like growth, which is the direction that reassures — and a first reading has nothing to grow from.
 * ⛔ AND A MALFORMED LAST ROW IS UNKNOWN, NOT ZERO. A row this cannot parse must not silently
 * become a baseline that every later reading beats.
 */
export function lastRecordedN(text) {
  const rows = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (rows.length < 2) return null;
  const fields = rows[rows.length - 1].split('\t');
  if (fields.length !== COLUMNS.length) return null;
  const raw = fields[COLUMNS.indexOf('n')];
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}
