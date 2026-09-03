// ⛔ IS THE UNTRACKED-FILE GAP DISCLOSED, OR SILENT?
//
// FINDING-watcher-misses-new-files.md (2026-09-02) proved a brand-new untracked file never reaches
// an incremental index, and its decision-relevant consequence was that M3a default-on would
// "silently miss every newly created file".
//
// ⚠ THAT FINDING PREDATES THE ABSENCE DISCLOSURE SHIPPED 2026-09-03. If a NO MATCH now names the
// uncommitted file and points at a remedy that works, the word "silently" is false and the M3a
// blocker rests on an expired measurement. That is the whole question here, and it is measured,
// not argued.
//
// PREREGISTERED — what each arm must show, written before the run:
//   C1 instrument    graph_callers('baseFn')      -> FINDS callers.  Else every absence below is vacuous.
//   C2 discriminator absent symbol, CLEAN tree    -> NO MATCH, NO 'uncommitted' clause.
//                                                   Else the clause is decoration, printed always.
//   T  the case      three verbs, untracked file  -> NO MATCH *and* names src/newthing.js.
//   C3 remedy        force:true, then re-query    -> symbol now present.
//                                                   Else the disclosure recommends something untrue.
//   C4 case C        commit it, then INCREMENTAL  -> symbol present without any force.
//                                                   The one live piece of the superseded finding.
//
// ABANDON RULE: if C1 or C2 fails, report the instrument as broken and conclude NOTHING about T.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repos = [];
const results = [];

function record(id, what, pass, detail) {
  results.push({ id, what, pass, detail });
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${id}  ${what}`);
  if (detail) console.log(`        ${detail}`);
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-untracked-disclosure-'));
  repos.push(dir);
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'base.js'),
`export function baseFn() { return 0; }
export function callsBase() { return baseFn(); }
`);
  const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return { dir, git };
}

const NEW_SRC = `export function brandNewFn() { return 1; }
`;

try {
  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
  const { graphCallees } = await import('../mcp/stdio/query/verbs/callees.js');
  const { graphImpact } = await import('../mcp/stdio/query/verbs/impact.js');

  // ---- main sequence: disclosure + remedy -------------------------------------------------
  const { dir: repo } = makeRepo();
  await graphIndex({ repoRoot: repo, force: false });

  const c1 = String(await graphCallers({ repoRoot: repo, symbol: 'baseFn' }));
  record('C1', 'instrument finds a real caller', /callsBase/.test(c1), c1.split('\n')[0]);

  const c2 = String(await graphCallers({ repoRoot: repo, symbol: 'zzqAbsentSymbol' }));
  record('C2', 'clean tree: absence carries NO uncommitted clause',
    !/uncommitted/i.test(c2), c2.split('\n').slice(0, 3).join(' | '));

  writeFileSync(join(repo, 'src', 'newthing.js'), NEW_SRC);
  await graphIndex({ repoRoot: repo, force: false });

  // ⚠ MORE THAN ONE VERB, DELIBERATELY. One verb passing would only show that ONE call site
  // composes the clause. The claim worth making is that the disclosure sits on the SHARED absence
  // path, and that needs independently-written call sites to agree.
  let t = '';
  for (const [name, fn] of [['graph_callers', graphCallers], ['graph_callees', graphCallees], ['graph_impact', graphImpact]]) {
    const out = String(await fn({ repoRoot: repo, symbol: 'brandNewFn' }));
    if (name === 'graph_callers') t = out;
    record(`T:${name}`, 'absence NAMES the untracked file as the reason',
      /newthing\.js/.test(out) && /uncommitted/i.test(out),
      out.split('\n').filter((l) => /uncommitted|NOT COVERED|NO MATCH/i.test(l)).join(' | ') || out.slice(0, 200));
  }

  await graphIndex({ repoRoot: repo, force: true });
  const c3 = String(await graphCallers({ repoRoot: repo, symbol: 'brandNewFn' }));
  record('C3', 'the recommended remedy (force:true) actually indexes it',
    !/NO MATCH/i.test(c3), c3.split('\n')[0]);

  // ---- case C, in its OWN repo ------------------------------------------------------------
  // ⛔ A SECOND REPO IS REQUIRED, NOT TIDINESS. C3 above ran force:true, which already pulled the
  // file in — asking the same repo whether a COMMIT would have indexed it could only ever say yes.
  const { dir: repoC, git: gitC } = makeRepo();
  await graphIndex({ repoRoot: repoC, force: false });
  writeFileSync(join(repoC, 'src', 'newthing.js'), NEW_SRC);
  gitC('add', '-A'); gitC('commit', '-qm', 'add newthing');
  await graphIndex({ repoRoot: repoC, force: false });
  const c4 = String(await graphCallers({ repoRoot: repoC, symbol: 'brandNewFn' }));
  record('C4', 'case C: a COMMITTED new file arrives via a plain incremental index',
    !/NO MATCH/i.test(c4), c4.split('\n')[0]);

  console.log('');
  console.log('FULL TEXT OF THE CASE UNDER TEST (T):');
  console.log('-----------------------------------------------');
  console.log(t);
  console.log('-----------------------------------------------');
  const controlsOk = results.find((r) => r.id === 'C1').pass && results.find((r) => r.id === 'C2').pass;
  console.log('');
  console.log(controlsOk
    ? 'CONTROLS HELD — the T verdict above is readable.'
    : 'CONTROLS FAILED — instrument broken, conclude NOTHING about T.');
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
} finally {
  for (const dir of repos) rmSync(dir, { recursive: true, force: true });
}
