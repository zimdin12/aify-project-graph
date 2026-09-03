// DOES AN ABSENCE NAME THE INDEXED SCOPE IT SEARCHED?
//
// M2's stop condition has two halves. The first — state what was NOT modelled — has been worked.
// The second is: **separate "no callers in indexed scope" from "no callers" and NAME the scope.**
//
// `spineScopeClause` names the CODE-INTEL scope well ("processed 73 of 627 eligible files"). That is
// the compiler-verified tier. The question here is the tier underneath it: when a repo has no
// collection at all — the ordinary case for a JS/Python repo — does the absence say anything about
// how much of the REPOSITORY the heuristic graph itself covers?
//
// ⛔ WHY IT MATTERS. "No callers" from a graph that indexed 881 of 881 files is a strong absence.
// The identical sentence from a graph that indexed 200 of 881 — an interrupted index, an ignore rule,
// an unindexed language — is nearly worthless, and an agent cannot tell them apart.
//
// PREREGISTERED, before the run:
//   POPULATION   one real indexed repo; both absence shapes from the same graph —
//                NO MATCH (symbol unknown) and NO CALLERS (symbol known, empty caller set).
//   IDENTITY RULE  the scope is NAMED when the answer states a POPULATION the analysis covered
//                (a file or symbol count), as opposed to naming something that is MISSING.
//                "no code-intel collection exists" names an absence, not a scope.
//   FINDING SCHEMA {shape, namesIndexedPopulation, text}
//   CLAIM CEILING  one repo, JS, no code-intel collection. It measures what these two verbs say on
//                this path; it is not a claim about every verb or every tier.
//   CONTROLS
//     POSITIVE  a symbol that DOES have callers returns them — so the graph is real and populated,
//               and an empty answer below is a genuine absence rather than a broken fixture.
//     NEGATIVE  a nonsense symbol returns an absence — so the verbs can produce the shape at all.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = mkdtempSync(join(tmpdir(), 'apg-indexed-scope-'));
const say = (...a) => console.log(...a);

// A count of files or symbols, presented as what WAS covered. Deliberately generous: any of these
// shapes would satisfy the requirement, so a negative result cannot be an artifact of a narrow regex.
const NAMES_POPULATION = [
  /\b\d+\s+(?:of\s+\d+\s+)?(?:indexed\s+)?files?\b/i,
  /\bindexed\s+\d+\b/i,
  /\b\d+\s+symbols?\s+indexed\b/i,
  /\bscope:[^.]*\b\d+\s+files?\b/i,
];
const namesPopulation = (t) => NAMES_POPULATION.some((re) => re.test(t));

try {
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'base.js'),
`export function hasCallers() { return 1; }
export function theCaller() { return hasCallers(); }
export function lonely() { return 2; }
`);
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
  await graphIndex({ repoRoot: repo, force: true });

  const control = String(await graphCallers({ repoRoot: repo, symbol: 'hasCallers' }));
  const controlOk = /theCaller/.test(control);
  say(`[${controlOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: a symbol with callers returns them`);

  const noMatch = String(await graphCallers({ repoRoot: repo, symbol: 'zzqNoSuchSymbol' }));
  const noCallers = String(await graphCallers({ repoRoot: repo, symbol: 'lonely' }));
  const shapesOk = /NO MATCH/.test(noMatch) && /NO CALLERS/.test(noCallers);
  say(`[${shapesOk ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: both absence shapes are produced`);

  if (!controlOk || !shapesOk) {
    say('⛔ CONTROLS FAILED — conclude nothing.');
    process.exitCode = 2;
  } else {
    const findings = [
      { shape: 'NO MATCH  (symbol unknown)', text: noMatch },
      { shape: 'NO CALLERS (empty set)    ', text: noCallers },
    ].map((f) => ({ ...f, namesIndexedPopulation: namesPopulation(f.text) }));

    say('');
    for (const f of findings) {
      say(`${f.shape}  names an indexed population? ${f.namesIndexedPopulation ? 'YES' : 'NO'}`);
    }
    say('');
    for (const f of findings) {
      say(`--- ${f.shape.trim()}`);
      say(f.text);
      say('');
    }

    const anyNamed = findings.some((f) => f.namesIndexedPopulation);
    say(anyNamed
      ? 'VERDICT: at least one absence shape names the indexed population.'
      : '⛔ VERDICT: NEITHER absence names how much of the repository was indexed. An agent cannot\n'
        + '   distinguish "no callers in a fully indexed repo" from "no callers in a partial index".');
    process.exitCode = anyNamed ? 0 : 1;
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
