// scripts/measure-callee-classes.mjs
// Separate real callees from extractor noise, by looking at the SOURCE LINE.
//
// ⛔ WHY THIS EXISTS. A guard shipped on 2026-08-26 refused a language's reserved words as callees
// and was reverted the same day because it deleted real edges: `promise.catch(() => null)` is an
// ordinary member call, and after member-target normalization the resolver sees the same bare string
// `catch` for that and for a `catch (e)` clause. The distinction is not recoverable from the label.
// It IS recoverable from the line the ref came from, which is what this measures.
//
// ⛔ AND IT IS COMMITTED RATHER THAN LEFT IN A SCRATCH DIRECTORY because the review that caught the
// defect also found that no executable carrier existed for any of the claims made about it. A number
// in a commit message that nobody can re-run is a number nobody can check.
//
// Usage:  node scripts/measure-callee-classes.mjs [repoRoot] [--json]
// Exit:   0 measured · 1 controls failed (nothing reported) · 2 no graph

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openExistingDb } from '../mcp/stdio/storage/db.js';

// ── classification ────────────────────────────────────────────────────────────
// Pure functions: a line and a label in, a class out. No I/O, no state.

const escapeForRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `x.label(` — positive proof of a member call. */
export function isMemberCall(line, label) {
  if (!line || !label) return false;
  return new RegExp(`\\.\\s*${escapeForRegex(label)}\\s*\\(`).test(line);
}

/** `label(` with no receiver — a real direct call OR a keyword construct like `catch (e)`. */
export function isBareCall(line, label) {
  if (!line || !label) return false;
  return new RegExp(`(?<![A-Za-z0-9_$.])${escapeForRegex(label)}\\s*\\(`).test(line);
}

/**
 * MEMBER  — proven a member call. A rule that refuses this label destroys a real edge.
 * BARE    — in call position with no receiver. Ambiguous by construction: `readFileSync(...)` and
 *           `catch (e)` are the same shape, and nothing on the line separates them.
 * NEITHER — the label never appears in call position ON THIS LINE. See CHAIN_WINDOW below: that is
 *           NOT the same as "not a callee", because a chain can span lines.
 */
export function classify(line, label) {
  if (isMemberCall(line, label)) return 'MEMBER';
  if (isBareCall(line, label)) return 'BARE';
  return 'NEITHER';
}

// ── controls ──────────────────────────────────────────────────────────────────

/**
 * ⛔ A CLASSIFIER THAT ANSWERS THE SAME THING FOR EVERY INPUT LOOKS EXACTLY LIKE A WORKING ONE IN
 * AGGREGATE. Both directions are checked on synthetic lines so the controls travel with the code and
 * do not depend on this repository still containing any particular source line.
 */
export function controlFailures() {
  const failures = [];
  const must = (cond, what) => { if (!cond) failures.push(what); };
  must(classify('await prior.catch(() => {});', 'catch') === 'MEMBER', 'member call not detected');
  must(classify('const t = new Date().toISOString();', 'new') === 'NEITHER', 'new Date() misread as a call');
  must(classify('} catch (e) {', 'catch') === 'BARE', 'catch clause should be BARE, not MEMBER');
  must(classify('const s = readFileSync(p);', 'readFileSync') === 'BARE', 'direct call not detected');
  must(classify('return myOwnJoin(a);', 'Join') === 'NEITHER', 'suffix match should not count as a call');
  must(classify('// we merely mention catch here', 'catch') === 'NEITHER', 'a prose mention is not a call');
  // ⛔ The widened window must EXPLAIN a real split chain and must NOT explain a name that is absent.
  // A window wide enough to explain everything would make the residual vanish for the wrong reason.
  const chain = ['return rows', '  .slice(0, 5)', '  .map(toRow);'].join('\n');
  must(isMemberCall(chain, 'slice'), 'a chain split across lines is not recognised in the window');
  must(!isMemberCall(chain, 'zzNotARealSymbolAnywhere'), 'the window explains a name that is absent');
  return failures;
}

// ── measurement ───────────────────────────────────────────────────────────────

// ⛔ A ONE-LINE CLASSIFIER CANNOT SEE A CHAIN THAT SPANS LINES, AND MOST NEITHER RESULTS ARE THAT.
//
// `return rows` / `  .slice(0, 5)` records source_line at the FIRST line, where `.slice(` does not
// appear. Measured after the chained-constructor fix: of 103 one-line NEITHER results, 88 have the
// member call within the next few lines and only 15 do not. Reporting 103 as "not a callee" would
// have overstated the defect population by roughly seven times.
//
// ⚠ So the window is a DISCLOSURE, not a reclassification. NEITHER stays NEITHER; the report says
// how many of them are explained this way, because the alternative is a number that reads as a
// defect count and is not one.
const CHAIN_WINDOW = 8;

function lineReader(repoRoot) {
  const cache = new Map();
  return (rel, n) => {
    if (!cache.has(rel)) {
      const p = join(repoRoot, rel);
      cache.set(rel, existsSync(p) ? readFileSync(p, 'utf8').split(/\r?\n/) : null);
    }
    const lines = cache.get(rel);
    return lines && n >= 1 && n <= lines.length ? lines[n - 1] : null;
  };
}

export function measure({ repoRoot, dbPath }) {
  const db = openExistingDb(dbPath);
  let rows;
  try {
    rows = db.all(
      `SELECT dst.label AS label, e.source_file AS file, e.source_line AS line
         FROM edges e JOIN nodes dst ON dst.id = e.to_id
        WHERE e.relation = 'CALLS' AND dst.type = 'External'
          AND dst.label <> '' AND e.source_file <> ''`,
    );
  } finally { db.close(); }

  const readLine = lineReader(repoRoot);
  const readWindow = (file, line) => {
    const out = [];
    for (let i = line; i < line + CHAIN_WINDOW; i += 1) {
      const l = readLine(file, i);
      if (l === null) break;
      out.push(l);
    }
    return out.join('\n');
  };
  const byLabel = new Map();
  const totals = { MEMBER: 0, BARE: 0, NEITHER: 0 };
  let unreadable = 0;
  let chainExplained = 0;

  for (const row of rows) {
    const line = readLine(row.file, row.line);
    if (line === null) { unreadable += 1; continue; }
    const cls = classify(line, row.label);
    totals[cls] += 1;
    if (cls === 'NEITHER' && isMemberCall(readWindow(row.file, row.line), row.label)) {
      chainExplained += 1;
    }
    if (!byLabel.has(row.label)) byLabel.set(row.label, { MEMBER: 0, BARE: 0, NEITHER: 0, samples: {} });
    const entry = byLabel.get(row.label);
    entry[cls] += 1;
    if (!entry.samples[cls]) entry.samples[cls] = `${row.file}:${row.line}  ${line.trim().slice(0, 70)}`;
  }

  return {
    unit: 'CALLS edges whose target is an External node',
    examined: rows.length - unreadable,
    unreadable,
    totals,
    chainExplained,
    byLabel,
  };
}

// ── entry point ───────────────────────────────────────────────────────────────

function main(argv) {
  const asJson = argv.includes('--json');
  const repoRoot = resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd());
  const dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');

  if (!existsSync(dbPath)) {
    console.error(`no graph at ${dbPath} — index the repository first`);
    return 2;
  }

  // ⛔ CONTROLS BEFORE ANY NUMBER IS PRODUCED, not after, and the run reports nothing if they fail.
  const failures = controlFailures();
  if (failures.length > 0) {
    console.error('CONTROLS FAILED — refusing to report:');
    failures.forEach((f) => console.error(`  · ${f}`));
    return 1;
  }

  const result = measure({ repoRoot, dbPath });
  if (asJson) {
    console.log(JSON.stringify({
      unit: result.unit,
      examined: result.examined,
      unreadable: result.unreadable,
      totals: result.totals,
      chainExplained: result.chainExplained,
      notCalleeAfterWindow: result.totals.NEITHER - result.chainExplained,
    }, null, 2));
    return 0;
  }

  const { MEMBER, BARE, NEITHER } = result.totals;
  console.log(`${result.examined} ${result.unit} (unreadable ${result.unreadable})\n`);
  console.log(`  MEMBER  ${String(MEMBER).padStart(5)}  proven a member call — refusing these destroys real edges`);
  console.log(`  BARE    ${String(BARE).padStart(5)}  call position, no receiver — AMBIGUOUS, cannot be split here`);
  console.log(`  NEITHER ${String(NEITHER).padStart(5)}  not in call position ON ITS LINE`);
  console.log(`     of which ${result.chainExplained} are a member call spread over more than one line —`);
  console.log(`     so the population this points at is ${NEITHER - result.chainExplained}, not ${NEITHER}`);

  const worst = [...result.byLabel]
    .filter(([, e]) => e.NEITHER > 0)
    .sort((a, b) => b[1].NEITHER - a[1].NEITHER)
    .slice(0, 15);
  console.log('\nlargest NEITHER labels (the extractor-defect population):');
  for (const [label, entry] of worst) {
    console.log(`  ${String(entry.NEITHER).padStart(4)}  ${JSON.stringify(label)}`);
    console.log(`        ${entry.samples.NEITHER}`);
  }

  const mixed = [...result.byLabel].filter(([, e]) => e.MEMBER > 0 && e.NEITHER > 0);
  console.log(`\nlabels appearing BOTH as a real member call and as noise: ${mixed.length}`);
  console.log('(a label-only rule cannot serve these at all — it must delete one class to remove the other)');
  for (const [label, e] of mixed.slice(0, 10)) console.log(`  ${label}: MEMBER ${e.MEMBER} / NEITHER ${e.NEITHER}`);
  return 0;
}

// ⛔ argv[1] IS UNDEFINED when this module is imported from an eval context (`node --input-type=
// module -e "import ..."`), and pathToFileURL(undefined) THROWS — so importing the predicates for a
// one-off measurement crashed before a single line ran. The repo has been bitten by this guard's
// other failure mode before (a two-slash `file://` never matching Node's three), where the symptom
// was silence rather than a stack trace. Guard the argument, not just the comparison.
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main(process.argv.slice(2)));
}
