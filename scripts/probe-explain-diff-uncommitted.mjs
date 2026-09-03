// IS graph_explain_diff EXPOSED TO THE SAME UNCOMMITTED GAP, OR NOT?
//
// Last cycle I wired the uncommitted-mention disclosure across six of eight buildTrustLine
// consumers. `graph_trace` was excluded on a correctness argument (an uncommitted file can only ADD
// an edge, so a FOUND path stays true). `graph_explain_diff` was marked **OPEN, not settled** — it
// has no single queried symbol to key the relevance gate on, but an uncommitted file CAN contain
// callers of the changed symbols, so the hazard is not obviously absent.
//
// ⛔ THIS EXISTS BECAUSE AN EXCLUSION IS A CLAIM. The cycle before, I excluded `graph_change_plan`
// with "a helper with two callers — a larger change", opened it later, and found the second caller
// was test-only and the fix was three lines. An estimate of effort is not a reason. So this measures
// rather than argues.
//
// PREREGISTERED, before the run:
//   POPULATION  a committed diff that changes a symbol, plus an UNCOMMITTED file calling it.
//   QUESTION 1  does explain_diff's result CLAIM something the uncommitted caller falsifies?
//               (i.e. does it enumerate affected callers at all?)
//   QUESTION 2  if so, does it disclose the uncommitted file?
//   CONTROLS
//     C1 the COMMITTED caller appears in the result   — else the verb does not enumerate callers,
//                                                        the hazard does not exist, and Q2 is moot
//     C2 the UNCOMMITTED caller does NOT appear        — else there is no gap
//     C3 on a CLEAN tree the result carries no uncommitted clause
//                                                      — else any clause is decoration
//   CLAIM CEILING  one repo, one language, one diff shape. Measures graph_explain_diff only.
//
// ABANDON RULE: if C1 fails — the verb never names callers — then the relevance gate has nothing to
// protect and the honest answer is "excluded, on an argument", not "not implemented".
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = mkdtempSync(join(tmpdir(), 'apg-explaindiff-'));
const say = (...a) => console.log(...a);
const results = [];
function record(id, what, pass, detail) {
  results.push({ id, pass });
  say(`[${pass ? 'PASS' : 'FAIL'}] ${id}  ${what}`);
  if (detail) say(`        ${String(detail).slice(0, 300)}`);
}

try {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'base.js'), 'export function target() { return 0; }\n');
  writeFileSync(join(repo, 'src', 'caller1.js'),
    "import { target } from './base.js';\nexport function committedCaller() { return target(); }\n");
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  // A committed change to the symbol, so there is a real diff range to explain.
  writeFileSync(join(repo, 'src', 'base.js'), 'export function target(extra) { return extra ?? 1; }\n');
  git('add', '-A'); git('commit', '-qm', 'change target signature');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  const { graphExplainDiff } = await import('../mcp/stdio/query/verbs/explain_diff.js');
  await graphIndex({ repoRoot: repo, force: false });

    // ⛔ THIS VERB RETURNS A STRUCTURED OBJECT, NOT PROSE — the server JSON-stringifies it
  // (explain_diff.js:346). My first version wrapped it in String(), which collapsed everything to
  // "[object Object]" and made every regex below test that literal. The abandon rule fired on the
  // artifact, and a conservative-looking verdict from a broken instrument is still a broken verdict.
  const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  const clean = asText(await graphExplainDiff({ repoRoot: repo, range: 'HEAD~1..HEAD' }));
  record('C3', 'clean tree: no uncommitted clause', !/uncommitted|MAY BE INCOMPLETE/i.test(clean),
    clean.split('\n')[0]);
  record('C1', 'the COMMITTED caller is named in the result (so the verb enumerates callers)',
    /committedCaller|caller1\.js/.test(clean), clean.split('\n').slice(0, 6).join(' | '));

  // Now the uncommitted caller of the same changed symbol.
  writeFileSync(join(repo, 'src', 'newcaller.js'),
    "import { target } from './base.js';\nexport function uncommittedCaller() { return target(1); }\n");
  await graphIndex({ repoRoot: repo, force: false });

  const out = asText(await graphExplainDiff({ repoRoot: repo, range: 'HEAD~1..HEAD' }));
  record('C2', 'the UNCOMMITTED caller is genuinely MISSING (a real gap)',
    !/uncommittedCaller/.test(out), 'searched whole response for uncommittedCaller');
  const disclosed = /MAY BE INCOMPLETE/.test(out) || /newcaller\.js/.test(out);
  record('Q2', 'the result discloses the uncommitted file', disclosed,
    out.split('\n').filter((l) => /uncommitted|INCOMPLETE|caller/i.test(l)).slice(0, 3).join(' | '));

  say('');
  say('FULL RESULT WITH AN UNCOMMITTED CALLER PRESENT:');
  say('-----------------------------------------------');
  say(out);
  say('-----------------------------------------------');
  say('');

  const c1 = results.find((r) => r.id === 'C1');
  if (!c1.pass) {
    say('⛔ ABANDON RULE FIRED: C1 failed — graph_explain_diff does NOT enumerate callers of the');
    say('   changed symbol, so an uncommitted caller falsifies no claim it makes. The honest');
    say('   disposition is EXCLUDED ON AN ARGUMENT, not "open".');
    process.exitCode = 2;
  } else if (!results.find((r) => r.id === 'C2').pass) {
    say('⛔ C2 failed: the uncommitted caller IS in the result, so there is no gap to disclose.');
    process.exitCode = 2;
  } else {
    say(disclosed
      ? 'VERDICT: already disclosed — nothing to do.'
      : '⛔ VERDICT: REAL GAP. explain_diff names affected callers, omits the uncommitted one, and\n'
        + '   says nothing — an agent reading blast radius before a change under-counts it.');
    process.exitCode = disclosed ? 0 : 1;
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
