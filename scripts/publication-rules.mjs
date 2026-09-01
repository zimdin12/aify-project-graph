// Pure decision rules for the evidence-publication gate.
//
// ⚠ SEPARATE FROM THE CLI ON PURPOSE. The CLI carries a `#!` shebang, which vitest's transform
// rejects when the file is imported as a module — the test could not load it at all. Rules that
// cannot be imported cannot be tested, and an untestable validator is the dead-instrument shape
// this repository keeps finding.
//
// ⛔ AND THE EXTRACTION ITSELF INTRODUCED A VACUOUS CHECK ONCE ALREADY. Rebuilding one regex inside
// a TEMPLATE LITERAL collapsed `\|` to `|` and `\s` to `s`, producing an alternation with an empty
// branch that matched every string, so the sidecar-schema check passed for any input. Only the
// test caught it. Hence the double-escaping below, and hence the omitted-field control.
import crypto from 'node:crypto';

// Only evidence may ride in a publication commit. A functional change hiding here would be
// certified by a gate that never ran a test.
export const ALLOWED = [/^docs\/evidence\//];

export const REQUIRED_FIELDS = ['subject commit', 'VITEST_EXIT', 'raw receipt', 'raw receipt sha256'];

/**
 * The gate's decision logic, separated from git and the filesystem so it can be tested without
 * constructing commits. A validator with no test is the dead-instrument shape this repository
 * keeps finding elsewhere; it must be able to FAIL on demand and be shown doing so.
 *
 * @param {{changedFiles:string[], sidecars:Array<{name:string,text:string,raw:{name:string,bytes:Buffer,exists:boolean,tracked:boolean}|null}>}} input
 */
export function evaluatePublication({ changedFiles = [], sidecars = [] } = {}) {
  const out = [];
  const add = (name, ok, detail = '') => out.push({ name, ok, detail });

  const stray = changedFiles.filter((f) => !ALLOWED.some((re) => re.test(f)));
  add('only evidence paths changed', stray.length === 0, stray.join(', '));
  add('at least one sidecar published', sidecars.length > 0, String(sidecars.length));

  for (const sc of sidecars) {
    // ⚠ DOUBLE-ESCAPED ON PURPOSE. In a template literal `\|` collapses to `|` and `\s` to `s`,
    // which turns this pattern into an ALTERNATION with an empty branch — it would match every
    // string and the schema check would pass vacuously. That is precisely what the extraction of
    // this function introduced, and only the test below caught it.
    const missing = REQUIRED_FIELDS.filter((f) => !new RegExp(`\\|\\s*${f}\\s*\\|`, 'i').test(sc.text));
    add(`sidecar schema: ${sc.name}`, missing.length === 0, missing.join(', '));

    const shaMatch = sc.text.match(/\|\s*raw receipt sha256\s*\|\s*`([0-9a-f]{64})`/i);
    const subjMatch = sc.text.match(/\|\s*subject commit\s*\|\s*`([0-9a-f]{40})`/i);
    add(`sidecar records a sha256: ${sc.name}`, Boolean(shaMatch));
    add(`sidecar names a subject commit: ${sc.name}`, Boolean(subjMatch));
    if (!sc.raw) { add(`raw receipt exists and is readable: ${sc.name}`, false); continue; }
    add(`raw receipt exists and is readable: ${sc.raw.name}`, sc.raw.exists);
    add(`raw receipt is tracked: ${sc.raw.name}`, sc.raw.tracked);
    if (!sc.raw.exists || !shaMatch) continue;

    const actual = crypto.createHash('sha256').update(sc.raw.bytes).digest('hex');
    add(`raw receipt sha256 matches sidecar: ${sc.raw.name}`, actual === shaMatch[1],
      `recomputed ${actual.slice(0, 16)} vs recorded ${shaMatch[1].slice(0, 16)}`);
    add(`no raw NUL: ${sc.raw.name}`, !sc.raw.bytes.includes(0));
    add(`no ANSI escapes: ${sc.raw.name}`, !sc.raw.bytes.includes(0x1b));
    add(`receipt carries VITEST_EXIT: ${sc.raw.name}`, /^VITEST_EXIT=\d+$/m.test(sc.raw.bytes.toString('utf8')));
  }
  return out;
}

