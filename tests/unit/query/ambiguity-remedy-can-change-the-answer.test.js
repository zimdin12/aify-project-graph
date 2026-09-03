// ⛔ A REMEDY MUST BE AN ACTION THAT CAN CHANGE THE ANSWER.
//
// The ambiguity message ended with "or use a file-specific query". Measured: the target is resolved
// by `expandClassRollupTargets(db, symbol)`, which never receives `file`; `file` filters the CALLER's
// path afterwards. So {symbol:'render', file:'src/alpha.js'} still returns AMBIGUOUS MATCH — verified
// with the file pointing at the target's own module AND at a caller's. The tool was recommending the
// one action that provably cannot resolve the ambiguity it was reporting.
//
// ⚠ THIS FILE FAMILY ALREADY NAMES THE DEFECT CLASS, in noMatchMessage: "RE-RUN WITH ONE OF THESE
// offered back the string the caller just passed, so the only action on offer reproduced this
// identical output forever ... the remedy must be an action that can change the answer."
// docs/evidence/m1-identity/FINDING-m1-stop-condition-verified.md
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let repo = null;
let graphCallers = null;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-ambiguity-remedy-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'alpha.js'), 'export function render() { return 1; }\n');
  writeFileSync(join(repo, 'src', 'beta.js'), 'export function render() { return 2; }\n');
  writeFileSync(join(repo, 'src', 'useAlpha.js'),
    "import { render } from './alpha.js';\nexport function alphaCaller() { return render(); }\n");
  const g = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  g('add', '-A'); g('commit', '-qm', 'fixture');
  const { graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js');
  ({ graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js'));
  await graphIndex({ repoRoot: repo, force: true });
}, 180_000);

afterAll(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

describe('the ambiguity message offers a remedy that works', () => {
  it('⛔ POSITIVE CONTROL: the bare name really is ambiguous here', async () => {
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'render' }));
    expect(out, 'else every assertion below is about the wrong shape').toMatch(/AMBIGUOUS MATCH/);
  }, 60_000);

  it('★★★ the remedy it names — a qualified name from the list — actually resolves', async () => {
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'render' }));
    expect(out, 'the candidates must be printed, or there is nothing to retry with')
      .toMatch(/src::alpha::render/);
    // The displayed spelling must work as input, or the remedy is inert in a second way.
    const retried = String(await graphCallers({ repoRoot: repo, symbol: 'src::alpha::render' }));
    expect(retried, 'the displayed form must resolve').toMatch(/alphaCaller/);
    expectAbsentWithLiveMatcher(
      /AMBIGUOUS MATCH/,
      { forbidden: 'AMBIGUOUS MATCH for "render". 2 concrete candidates found:',
        allowed: 'EDGE alphaCaller→src::alpha::render CALLS src/useAlpha.js:2' },
      retried,
      'retrying with the named remedy must leave the ambiguity behind, not reproduce it',
    );
  }, 120_000);

  it('⛔ it no longer recommends file=, which provably cannot disambiguate', async () => {
    // Both spellings measured: the file pointing at the target's module, and at a caller's.
    const viaTargetFile = String(await graphCallers({ repoRoot: repo, symbol: 'render', file: 'src/alpha.js' }));
    const viaCallerFile = String(await graphCallers({ repoRoot: repo, symbol: 'render', file: 'src/useAlpha.js' }));
    expect(viaTargetFile, 'file= does not narrow the target — this is the measured behaviour')
      .toMatch(/AMBIGUOUS MATCH/);
    expect(viaCallerFile).toMatch(/AMBIGUOUS MATCH/);

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'render' }));
    expectAbsentWithLiveMatcher(
      /use a file-specific query/,
      { forbidden: 'Retry with a qualified symbol (Class::method) or use a file-specific query.',
        allowed: 'Retry with one of the qualified names listed above — they resolve as shown.' },
      out,
      'the message must not send a reader to the one action that cannot help',
    );
    expect(out, 'and it should say what file= actually does, so the reader is not left guessing')
      .toMatch(/filters which CALLERS are listed/);
  }, 120_000);
});
