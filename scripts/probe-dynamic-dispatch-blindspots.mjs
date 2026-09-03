// ARE THE BLIND SPOTS I WANT TO DECLARE ACTUALLY BLIND?
//
// `constructCoverageClause` states what the analysis cannot see, and it exists for C/C++ only —
// measured: 2 of 12 configured languages. Extending it to JS/TS and Python means asserting that
// specific constructs are invisible to our extractor.
//
// ⛔ THAT IS A SEMANTIC CLAIM AND MUST NOT BE WRITTEN FROM INTUITION. This repo's standing rule is
// never to slide from a textual claim to a semantic one; declaring "dynamic dispatch is invisible"
// without executing the extractor over it would be exactly that. So each construct gets a fixture.
//
// PREREGISTERED, before the run:
//   POPULATION    one file per construct, per language, indexed by the real pipeline.
//   IDENTITY RULE a construct is BLIND when the graph holds NO edge from the calling function to the
//                 called one, while the CONTROL — an ordinary direct call in the same file — DOES
//                 produce one.
//   CLAIM CEILING each result licenses ONE sentence about ONE construct in ONE language on this
//                 extractor version. It says nothing about clangd/pyright-verified tiers.
//   CONTROLS      per language, in the same pass: a direct call MUST produce an edge (else the
//                 extractor is not working and every "blind" below is an artifact).
//
// ABANDON RULE: if a language's direct-call control produces no edge, report that language as
// UNMEASURED and write no clause for it.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const say = (...a) => console.log(...a);
const repo = mkdtempSync(join(tmpdir(), 'apg-blindspot-'));

const CASES = {
  javascript: {
    file: 'src/dyn.js',
    text: `export function sink() { return 1; }
export function controlCaller() { return sink(); }
const table = { sink };
export function dynamicCaller(name) { return table[name](); }
export function computedCaller(o, k) { return o[k](); }
`,
    control: ['controlCaller', 'sink'],
    blind: [['dynamicCaller', 'sink'], ['computedCaller', 'sink']],
  },
  python: {
    file: 'src/dyn.py',
    text: `def sink():
    return 1

def control_caller():
    return sink()

def dynamic_caller(obj, name):
    return getattr(obj, name)()
`,
    control: ['control_caller', 'sink'],
    blind: [['dynamic_caller', 'sink']],
  },
};

function edgeExists(db, fromLabel, toLabel) {
  const row = db.get(`
    SELECT COUNT(*) AS c FROM edges e
    JOIN nodes f ON f.id = e.from_id
    JOIN nodes t ON t.id = e.to_id
    WHERE f.label = $f AND t.label = $t
  `, { f: fromLabel, t: toLabel });
  return (row?.c ?? 0) > 0;
}

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  for (const c of Object.values(CASES)) writeFileSync(join(repo, c.file), c.text);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'fixtures');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  await graphIndex({ repoRoot: repo, force: true });
  const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));

  const verdicts = {};
  try {
    for (const [lang, c] of Object.entries(CASES)) {
      const controlOk = edgeExists(db, c.control[0], c.control[1]);
      say(`--- ${lang}`);
      say(`  [${controlOk ? 'PASS' : 'FAIL'}] CONTROL: direct call ${c.control[0]} -> ${c.control[1]} produces an edge`);
      if (!controlOk) {
        say('  ⛔ ABANDON for this language: the extractor produced no edge for an ordinary call.');
        say('     Report UNMEASURED and write no clause.');
        verdicts[lang] = 'UNMEASURED';
        continue;
      }
      const blindResults = c.blind.map(([f, t]) => ({ f, t, seen: edgeExists(db, f, t) }));
      for (const b of blindResults) {
        say(`  ${b.seen ? '[SEEN ]' : '[BLIND]'} ${b.f} -> ${b.t}`);
      }
      verdicts[lang] = blindResults.every((b) => !b.seen) ? 'BLIND (clause justified)'
        : blindResults.some((b) => !b.seen) ? 'PARTIAL' : 'SEEN (no clause)';
      say(`  => ${verdicts[lang]}`);
    }
  } finally { db.close?.(); }

  say('');
  say('VERDICTS: ' + JSON.stringify(verdicts));
  process.exitCode = 0;
} finally {
  rmSync(repo, { recursive: true, force: true });
}
