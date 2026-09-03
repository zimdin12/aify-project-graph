// DOES M1's STOP CONDITION ACTUALLY HOLD, ON RUNNING CODE?
//
// M1: "graph_callers already refuses a bare ambiguous name, but the refusal is a DEAD END; make it
// return the qualified candidates WITH their caller sets. Stop when a same-name-different-symbol
// fixture proves the sets do not merge."
//
// I have reported M1 closed for many cycles from a summary. Last cycle I discovered M2 was NOT
// closed when I said it was, so the same scepticism applies here — and this particular check has
// fooled me before.
//
// ⛔ THE FIRST M1 VERIFICATION WAS VACUOUS AND PASSED. It compared two caller sets that were both
// EMPTY, which are trivially disjoint: the positive control used a direct function call while the
// case under test was a method call through a variable, so nothing resolved and "the sets do not
// merge" was true of nothing. The non-empty control below is the entire reason this probe can be
// believed.
//
// PREREGISTERED, before the run:
//   POPULATION   two functions sharing a NAME in different modules, each with its own distinct
//                caller, indexed by the real pipeline.
//   IDENTITY RULE  the sets DO NOT MERGE when the answer for one qualified symbol contains its own
//                caller and NOT the other's. Both directions are checked; one direction can pass by
//                luck of ordering.
//   CLAIM CEILING  one language, one fixture shape, this extractor version. It says nothing about
//                C++ overloads or cross-language collisions.
//   CONTROLS (same pass)
//     ANTI-VACUITY  each caller set must be NON-EMPTY — else disjointness is trivial and the
//                   assertion proves nothing. This is the control whose absence produced a false
//                   pass before.
//     CORRECTNESS   each set must contain the caller that genuinely calls THAT symbol.
//     BARE NAME     querying the unqualified name must not be a dead end: M1 asks for the qualified
//                   candidates WITH their caller sets, so a bare refusal that names nothing is a
//                   FAILURE of the milestone, not a pass.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = mkdtempSync(join(tmpdir(), 'apg-m1-'));
const say = (...a) => console.log(...a);

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  // Same NAME, two different symbols, each with its own caller.
  writeFileSync(join(repo, 'src', 'alpha.js'), 'export function render() { return "alpha"; }\n');
  writeFileSync(join(repo, 'src', 'beta.js'), 'export function render() { return "beta"; }\n');
  writeFileSync(join(repo, 'src', 'useAlpha.js'),
    "import { render } from './alpha.js';\nexport function alphaCaller() { return render(); }\n");
  writeFileSync(join(repo, 'src', 'useBeta.js'),
    "import { render } from './beta.js';\nexport function betaCaller() { return render(); }\n");
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'fixture');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
  const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
  await graphIndex({ repoRoot: repo, force: true });

  // Discover how the graph QUALIFIES the two same-named symbols rather than guessing a scheme.
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  let rows = [];
  try {
    rows = db.all(`
      SELECT id, label, file_path, json_extract(extra, '$.qname') AS qname
      FROM nodes WHERE label = 'render' AND type = 'Function' ORDER BY file_path
    `);
  } finally { db.close?.(); }

  say(`symbols named "render" in the graph: ${rows.length}`);
  for (const r of rows) say(`  ${r.file_path}   qname=${JSON.stringify(r.qname)}`);
  if (rows.length < 2) {
    say('⛔ the fixture did not produce two distinct same-named symbols — CONCLUDE NOTHING.');
    process.exitCode = 2;
  } else {
    const alpha = rows.find((r) => r.file_path.includes('alpha'));
    const beta = rows.find((r) => r.file_path.includes('beta'));
    const qA = alpha?.qname || 'render';
    const qB = beta?.qname || 'render';
    say('');
    say(`querying qualified: A=${JSON.stringify(qA)}  B=${JSON.stringify(qB)}`);

    // ⛔ QUALIFIED NAME ALONE. My first version ALSO passed `file`, and that combination fell back
    // to AMBIGUOUS MATCH — both sets came back empty and the anti-vacuity control failed. The
    // instrument was wrong, not the feature. ⚠ That fallback is itself worth knowing: adding a MORE
    // specific constraint produced a LESS specific answer, which an agent could easily trip over.
    const outA = String(await graphCallers({ repoRoot: repo, symbol: qA }));
    const outB = String(await graphCallers({ repoRoot: repo, symbol: qB }));

    const aHasOwn = /alphaCaller/.test(outA);
    const bHasOwn = /betaCaller/.test(outB);
    const aHasOther = /betaCaller/.test(outA);
    const bHasOther = /alphaCaller/.test(outB);

    say('');
    say(`[${aHasOwn && bHasOwn ? 'PASS' : 'FAIL'}] ANTI-VACUITY + CORRECTNESS: each set is NON-EMPTY and holds its OWN caller`);
    say(`        A contains alphaCaller: ${aHasOwn}    B contains betaCaller: ${bHasOwn}`);
    if (!aHasOwn || !bHasOwn) {
      say('⛔ At least one caller set is empty or wrong. Two empty sets are trivially disjoint —');
      say('   this is exactly the shape that produced a FALSE PASS before. CONCLUDE NOTHING.');
      process.exitCode = 2;
    } else {
      const merged = aHasOther || bHasOther;
      say(`[${merged ? 'FAIL' : 'PASS'}] ★★★ THE SETS DO NOT MERGE (both directions checked)`);
      say(`        A contains betaCaller: ${aHasOther}   B contains alphaCaller: ${bHasOther}`);

      // BARE NAME: M1 asks for the qualified candidates WITH their caller sets, not a dead end.
      const bare = String(await graphCallers({ repoRoot: repo, symbol: 'render' }));
      const namesBoth = /alpha\.js/.test(bare) && /beta\.js/.test(bare);
      const showsCallerSets = /alphaCaller/.test(bare) && /betaCaller/.test(bare);
      say('');
      say(`[${namesBoth ? 'PASS' : 'FAIL'}] BARE NAME names both candidates`);
      say(`[${showsCallerSets ? 'PASS' : 'FAIL'}] BARE NAME carries their CALLER SETS (M1's actual ask)`);
      say('');
      say('--- bare-name answer ---');
      say(bare);
      say('------------------------');
      process.exitCode = (!merged && namesBoth && showsCallerSets) ? 0 : 1;
    }
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
