// DOES A NON-EMPTY RESULT DISCLOSE THAT AN UNCOMMITTED FILE MIGHT ADD TO IT?
//
// M2 is "contract in EVERY result". The disclosure work of 2026-09-03 covered ABSENCE: a NO MATCH or
// an empty caller set now names the uncommitted files that could explain it.
//
// ⛔ THE DANGEROUS CASE MAY BE THE OTHER ONE. An agent asking "who calls target()" before changing it
// gets a LIST. A list reads as authoritative in a way an absence does not — the agent has three
// callers, updates them, and breaks a fourth that lives in a file it wrote five minutes ago and has
// not committed. An incomplete answer that looks complete is worse than a refusal.
//
// PREREGISTERED, before the run:
//   POPULATION  one symbol with one COMMITTED caller and one UNCOMMITTED caller, on a real graph.
//   QUESTION    does the non-empty `graph_callers` result mention the uncommitted file at all?
//   CONTROLS    (all in the same pass)
//     C1 the committed caller IS listed        — else the instrument is broken and nothing is readable
//     C2 the uncommitted caller is NOT listed  — else there is no gap to disclose and the question is moot
//     C3 on a CLEAN tree the same query says nothing about uncommitted files
//                                              — else any clause found is decoration, not a signal
//   CLAIM CEILING  one verb, one repo, one language. This measures `graph_callers`; it does not
//                  license a statement about "every verb" without measuring them.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = mkdtempSync(join(tmpdir(), 'apg-nonempty-'));
const say = (...a) => console.log(...a);
const results = [];
function record(id, what, pass, detail) {
  results.push({ id, pass });
  say(`[${pass ? 'PASS' : 'FAIL'}] ${id}  ${what}`);
  if (detail) say(`        ${detail}`);
}

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'base.js'),
`export function target() { return 0; }
export function committedCaller() { return target(); }
`);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
  await graphIndex({ repoRoot: repo, force: false });

  // C3 first, while the tree is still clean.
  const clean = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
  record('C3', 'clean tree: a non-empty result says nothing about uncommitted files',
    !/uncommitted/i.test(clean), clean.split('\n')[0]);

  // Now add an UNCOMMITTED caller and re-index incrementally (the deferral leaves it out).
  writeFileSync(join(repo, 'src', 'newcaller.js'),
`import { target } from './base.js';
export function uncommittedCaller() { return target(); }
`);
  await graphIndex({ repoRoot: repo, force: false });

  const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));

  record('C1', 'the COMMITTED caller is listed', /committedCaller/.test(out), out.split('\n')[0]);
  record('C2', 'the UNCOMMITTED caller is genuinely MISSING (so there is a gap to disclose)',
    !/uncommittedCaller/.test(out), 'searched the whole response for uncommittedCaller');

  const disclosed = /uncommitted/i.test(out) || /newcaller\.js/.test(out);
  record('Q', 'THE QUESTION: the non-empty result discloses the uncommitted file', disclosed,
    out.split('\n').filter((l) => /uncommitted|NOT COVERED|caller/i.test(l)).slice(0, 4).join(' | '));

  say('');
  say('FULL NON-EMPTY RESULT:');
  say('-----------------------------------------------');
  say(out);
  say('-----------------------------------------------');
  say('');

  const controlsOk = ['C1', 'C2', 'C3'].every((id) => results.find((r) => r.id === id)?.pass);
  if (!controlsOk) {
    say('⛔ CONTROLS FAILED — conclude nothing about the question.');
    process.exitCode = 2;
  } else {
    say(disclosed
      ? 'VERDICT: the gap IS disclosed on a non-empty result. No defect here.'
      : '⛔ VERDICT: a non-empty caller set is SILENTLY INCOMPLETE. The agent is shown a list that\n'
        + '   reads as authoritative, with an uncommitted caller missing and nothing saying so.');
    process.exitCode = disclosed ? 0 : 1;
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
