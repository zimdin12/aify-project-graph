// ⛔ A LIST READS AS AUTHORITATIVE IN A WAY AN ABSENCE DOES NOT.
//
// The disclosure work of 2026-09-03 covered absence: a NO MATCH names the uncommitted files that
// could explain it. A NON-EMPTY caller set carried nothing — so an agent asking "who calls target"
// before changing it got one caller, updated it, and broke a second living in a file it had written
// minutes earlier and not committed. Grep would have found that caller.
// Measured: docs/evidence/m2-contract/FINDING-nonempty-results-are-silently-incomplete.md
//
// ⚠ THE OBVIOUS FIX WAS ALREADY REJECTED BY THIS REPO, and the second test here is why it stays
// rejected. `uncommittedSourceClause` says ONLY ON AN ABSENCE, because the 592-untracked field
// report taught that a warning on every read is noise. On an actively-edited repository uncommitted
// source files ALWAYS exist, so an existence-gated clause fires on every result forever and is read
// as decoration.
//
// ⇒ The gate is the SYMBOL, not the tree. These tests pin both halves: it must fire when an
// uncommitted file mentions the queried name, and it must stay SILENT when uncommitted files exist
// and do not. Delete the second test and the feature quietly becomes the thing that was rejected.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

let repo = null;
let graphCallers = null;
let graphIndex = null;

beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'apg-nonempty-mention-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'base.js'),
    'export function target() { return 0; }\nexport function committedCaller() { return target(); }\n');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');

  ({ graphIndex } = await import('../../../mcp/stdio/query/verbs/index.js'));
  ({ graphCallers } = await import('../../../mcp/stdio/query/verbs/callers.js'));
  await graphIndex({ repoRoot: repo, force: false });
}, 180_000);

afterAll(() => { if (repo) { rmSync(repo, { recursive: true, force: true }); repo = null; } });

describe('a non-empty result names uncommitted files that MENTION the queried symbol', () => {
  it('⛔ POSITIVE CONTROL: the committed caller is listed — else every assertion below is vacuous', async () => {
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'the fixture graph must actually hold the caller edge').toMatch(/committedCaller/);
  }, 60_000);

  it('⛔ THE DESIGN CONTROL: an uncommitted file that does NOT mention the symbol stays SILENT', async () => {
    // This is the test that keeps the feature from becoming the always-on warning the 592-untracked
    // field report ruled out. If this ever goes green by accident the clause has stopped being a
    // signal and started being decoration.
    writeFileSync(join(repo, 'src', 'unrelated.js'), 'export function somethingElse() { return 42; }\n');
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'the result must still be the real one').toMatch(/committedCaller/);
    expect(out, 'a dirty tree ALONE must not trigger the clause — only relevance may')
      .not.toMatch(/MAY BE INCOMPLETE/);
  }, 120_000);

  it('★★★ an uncommitted file that DOES mention the symbol is named, with a remedy', async () => {
    writeFileSync(join(repo, 'src', 'newcaller.js'),
      "import { target } from './base.js';\nexport function uncommittedCaller() { return target(); }\n");
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'the uncommitted caller is genuinely absent from the set — that is the gap')
      .not.toMatch(/uncommittedCaller/);
    expect(out, 'so the agent must be told the set may be short').toMatch(/MAY BE INCOMPLETE/);
    expect(out, 'and WHICH file, or the doubt is not checkable').toMatch(/newcaller\.js/);
    expect(out, 'and a remedy that can change the answer').toMatch(/graph_index\(\{force:true\}\)/);
  }, 120_000);

  it('⛔ the clause makes a TEXTUAL claim, never a semantic one', async () => {
    // Finding the name in an unindexed file does not establish a call — it could be a comment, a
    // string, or an unrelated identifier. Saying "calls" would be an inference the scan cannot
    // support, and sliding from textual to semantic in prose is a standing prohibition here.
    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    const clause = out.split('\n').find((l) => l.includes('MAY BE INCOMPLETE')) ?? '';
    expect(clause, 'precondition: the clause is present in this arm').toMatch(/MAY BE INCOMPLETE/);
    expect(clause, 'it must report a MENTION').toMatch(/mentions/);
    expect(clause, 'and must not claim the file calls the symbol').not.toMatch(/\bcalls\b/);
  }, 60_000);
});

// ⛔ THE SWEEP MUST REACH MORE THAN THE VERB IT WAS WRITTEN FOR.
//
// buildTrustLine serves eight verbs. Wiring only `graph_callers` would leave the same silent gap in
// the other seven while the finding read as closed — "one fix is not a sweep" is a lesson this repo
// has paid for repeatedly. These assert the EFFECT through two more verbs, because passing the
// argument proves the wiring and not that the value survived to the output.
//
// ⚠ WHAT IS DELIBERATELY NOT COVERED, said plainly rather than left to be discovered:
//   graph_change_plan — its trust line is built in `buildChangePlanWithContext`, a helper with two
//     callers and no `freshness` parameter. Threading it is a larger change than this one, and
//     half-threading a shared helper is worse than a stated gap.
//   graph_explain_diff, graph_trace — neither has ONE queried symbol (a range, and a from/to pair),
//     so the relevance gate has nothing to gate on.
describe('the disclosure reaches other verbs on the shared trust line', () => {
  it('★★★ graph_callees names a relevant uncommitted file too', async () => {
    // ⚠ THE FIXTURE HAD TO BE FIXED, AND THE FIRST FAILURE WAS MINE. Querying callees of `target`
    // returns NO CALLEES — target calls nothing — so it took the ABSENCE path and emitted the
    // absence clause, correctly. The relevance gate lives on the NON-EMPTY path, so this needs a
    // symbol that HAS callees and is itself mentioned by an uncommitted file.
    const { graphCallees } = await import('../../../mcp/stdio/query/verbs/callees.js');
    writeFileSync(join(repo, 'src', 'mentions-caller.js'),
      '// a note about committedCaller, still uncommitted\nexport function noteFn() { return 1; }\n');
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallees({ repoRoot: repo, symbol: 'committedCaller' }));
    expect(out, 'precondition: this must be the NON-EMPTY path, not an absence').toMatch(/target/);
    expect(out, 'callees shares buildTrustLine, so it must carry the same clause')
      .toMatch(/MAY BE INCOMPLETE/);
    expect(out).toMatch(/mentions-caller\.js/);
  }, 120_000);

  it('★★★ graph_neighbors names it as well', async () => {
    const { graphNeighbors } = await import('../../../mcp/stdio/query/verbs/neighbors.js');
    const out = String(await graphNeighbors({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'neighbors shares buildTrustLine').toMatch(/MAY BE INCOMPLETE/);
    expect(out).toMatch(/newcaller\.js/);
  }, 120_000);
});
