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
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

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
    expectAbsentWithLiveMatcher(
      /MAY BE INCOMPLETE/,
      {
        forbidden: 'MAY BE INCOMPLETE: src/x.js (untracked) — uncommitted, so not indexed',
        allowed: 'EDGE committedCaller→target CALLS src/base.js:2 conf=0.90',
      },
      out,
      'a dirty tree ALONE must not trigger the clause — only relevance may',
    );
  }, 120_000);

  it('⛔ SUBSTRING-ONLY: an uncommitted file containing `retarget` does NOT count as mentioning `target`', async () => {
    // The measured defect, end to end. Before the identifier-boundary fix this file fired the clause
    // and told the agent it mentioned `target` — 47.4% of relevance decisions on this repo's own
    // short labels were of exactly this kind.
    writeFileSync(join(repo, 'src', 'substring-only.js'),
      'export function retargeted() { return 1; }\nexport const budgetTarget = 2;\n');
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'the result must still be the real one').toMatch(/committedCaller/);
    expectAbsentWithLiveMatcher(
      /substring-only\.js/,
      {
        forbidden: 'MAY BE INCOMPLETE: src/substring-only.js (untracked) — uncommitted',
        allowed: 'MAY BE INCOMPLETE: src/newcaller.js (untracked) — uncommitted',
      },
      out,
      'a file where the name only sits inside longer identifiers must not be called a mention',
    );
  }, 120_000);

  it('★★★ an uncommitted file that DOES mention the symbol is named, with a remedy', async () => {
    writeFileSync(join(repo, 'src', 'newcaller.js'),
      "import { target } from './base.js';\nexport function uncommittedCaller() { return target(); }\n");
    await graphIndex({ repoRoot: repo, force: false });

    const out = String(await graphCallers({ repoRoot: repo, symbol: 'target' }));
    expectAbsentWithLiveMatcher(
      /uncommittedCaller/,
      {
        forbidden: 'EDGE uncommittedCaller→target CALLS src/newcaller.js:2',
        // ⚠ The allowed canary is the caller that IS listed. It shares a suffix with the forbidden
        // name, so a matcher loose enough to confuse them fails here rather than passing quietly.
        allowed: 'EDGE committedCaller→target CALLS src/base.js:2',
      },
      out,
      'the uncommitted caller is genuinely absent from the set — that is the gap',
    );
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
    expectAbsentWithLiveMatcher(
      /\bcalls\b/,
      {
        forbidden: 'MAY BE INCOMPLETE: src/newcaller.js (untracked) — uncommitted, and calls "target".',
        // The real wording, which must NOT trip the matcher — and note "CALLS" appears uppercase in
        // edge lines elsewhere, so a case-insensitive version of this matcher would be overbroad.
        allowed: 'MAY BE INCOMPLETE: src/newcaller.js (untracked) — uncommitted, and mentions "target".',
      },
      clause,
      'the clause must not claim the file calls the symbol',
    );
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
//   graph_trace — EXCLUDED ON A CORRECTNESS ARGUMENT, not on effort. An uncommitted file can only
//     ADD an edge, never remove one, so a FOUND path stays true regardless of what is unindexed;
//     and the no-path branch already passes `freshness` to buildAbsenceTrustLine, so the absence
//     side is covered. The claim trace makes is "there IS a path", not "this is the only path".
//   graph_explain_diff — ⚠ OPEN, not settled. It has no single symbol (it explains a range), so the
//     gate has nothing to key on as written; but an uncommitted file CAN contain callers of the
//     changed symbols, so the hazard is not obviously absent. Keying the gate on the SET of changed
//     symbols would be a real extension. Recorded as unmeasured rather than dismissed.
//
// ⚠ graph_change_plan WAS on that list and no longer is. The stated reason — "a helper with two
// callers" — was half true: the second caller (`buildChangePlan`) is used only by tests, so the
// production path is single and threading `freshness` through was small. I had judged the size
// without opening it.
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

// graph_change_plan is the verb an agent reads BEFORE editing, so an incomplete caller picture there
// is the most consequential of all. Its trust line is built inside a helper, which is why the
// freshness had to be threaded rather than read from an enclosing scope.
describe('graph_change_plan carries the disclosure too', () => {
  it('★★★ a relevant uncommitted file is named on the change plan', async () => {
    const { graphChangePlan } = await import('../../../mcp/stdio/query/verbs/change_plan.js');
    const out = String(await graphChangePlan({ repoRoot: repo, symbol: 'target' }));
    expect(out, 'precondition: this is a real change plan, not an error').toMatch(/CHANGE_PLAN|READ ORDER/);
    expect(out, 'change_plan builds its trust line in a helper — the value must survive the thread')
      .toMatch(/MAY BE INCOMPLETE/);
    expect(out).toMatch(/newcaller\.js/);
  }, 120_000);
});

// ⛔ graph_explain_diff KEYS ON THE SET OF CHANGED SYMBOLS, not a single queried one.
//
// It enumerates the callers of the changed symbols (`affected_1hop.by_file`), so an uncommitted
// caller makes that enumeration short — on the verb whose entire job is to say what a change will
// break. I first excluded it for having "no single symbol", which generalised from the shape of the
// ARGUMENT to the absence of the DATA: the names are in `changedSymbols`.
//
// ⚠ THIS VERB RETURNS A STRUCTURED OBJECT, not prose. The probe that found this wrapped it in
// String(), collapsing it to "[object Object]", and the resulting false verdict was the
// CONSERVATIVE one — it agreed with what I already believed. Hence JSON.stringify here.
describe('graph_explain_diff discloses an uncommitted caller of a CHANGED symbol', () => {
  let diffRepo = null;
  afterAll(() => { if (diffRepo) rmSync(diffRepo, { recursive: true, force: true }); });

  it('★★★ names the uncommitted file, keyed on the changed-symbol set', async () => {
    const { graphIndex: gi } = await import('../../../mcp/stdio/query/verbs/index.js');
    const { graphExplainDiff } = await import('../../../mcp/stdio/query/verbs/explain_diff.js');
    diffRepo = mkdtempSync(join(tmpdir(), 'apg-explaindiff-test-'));
    mkdirSync(join(diffRepo, 'src'), { recursive: true });
    writeFileSync(join(diffRepo, 'src', 'base.js'), 'export function target() { return 0; }\n');
    writeFileSync(join(diffRepo, 'src', 'caller1.js'),
      "import { target } from './base.js';\nexport function committedCaller() { return target(); }\n");
    const g = (...a) => execFileSync('git', ['-C', diffRepo, ...a], { encoding: 'utf8', stdio: 'pipe' });
    g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
    g('add', '-A'); g('commit', '-qm', 'base');
    writeFileSync(join(diffRepo, 'src', 'base.js'), 'export function target(extra) { return extra ?? 1; }\n');
    g('add', '-A'); g('commit', '-qm', 'change target');
    await gi({ repoRoot: diffRepo, force: false });

    const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
    const before = asText(await graphExplainDiff({ repoRoot: diffRepo, range: 'HEAD~1..HEAD' }));
    expect(before, 'CONTROL: the verb must enumerate callers, or there is no claim to protect')
      .toMatch(/caller1\.js/);
    expectAbsentWithLiveMatcher(
      /MAY BE INCOMPLETE/,
      {
        forbidden: 'MAY BE INCOMPLETE: src/newcaller.js (untracked) — uncommitted, so not indexed',
        allowed: '"file": "src/caller1.js", "affected_symbols": ["committedCaller"]',
      },
      before,
      'CONTROL: a clean tree carries no clause',
    );

    writeFileSync(join(diffRepo, 'src', 'newcaller.js'),
      "import { target } from './base.js';\nexport function uncommittedCaller() { return target(1); }\n");
    await gi({ repoRoot: diffRepo, force: false });

    const after = asText(await graphExplainDiff({ repoRoot: diffRepo, range: 'HEAD~1..HEAD' }));
    expectAbsentWithLiveMatcher(
      /uncommittedCaller/,
      {
        forbidden: '"affected_symbols": ["uncommittedCaller"]',
        // The caller that IS enumerated, and it shares a suffix — a matcher loose enough to confuse
        // the two fails here instead of passing quietly.
        allowed: '"affected_symbols": ["committedCaller"]',
      },
      after,
      'the uncommitted caller is genuinely absent — that is the gap',
    );
    expect(after, 'so the blast radius must be flagged as possibly short').toMatch(/MAY BE INCOMPLETE/);
    expect(after).toMatch(/newcaller\.js/);
  }, 180_000);
});
