// ⛔ A "NO MATCH" IS A CLAIM, AND IT MUST NOT READ AS A FACT ABOUT THE REPOSITORY.
//
// Preregistered: docs/evidence/m2-construct-coverage/PREREGISTRATION-no-match-names-its-scope.md
//
// M2's stop condition is "every absence-shaped answer carries a scope statement an agent can act
// on". `NO MATCH` does not route through buildAbsenceTrustLine, so the disclosure work on that
// builder never touched it. Measured 2026-09-02: graph_callers, graph_callees, graph_impact and
// graph_change_plan all answered a bare `NO MATCH for "X". Try graph_search(...)` — while
// graph_whereis, which the repo had already fixed, named its scope. One fix was not a sweep.
//
// ⚠ TWO DIFFERENT MEASURED FACTS, because the verbs search different populations:
//   - callers/callees/impact resolve across ALL node types, so the fact is INDEX STALENESS
//     (n commits behind HEAD). Silent on a fresh index — no noise on the happy path.
//   - change_plan restricts to SEARCH_TYPES, so the fact is WHICH OF THOSE TYPES ARE EMPTY, the
//     same fact graph_whereis names.
// Applying one fix to both would have put the wrong noun on one of them.
//
// ⚠ CEILING: this checks WHAT THE TEXT SAYS on one fixture. It does not show an agent reads it or
// changes a decision — that is the A/B's question, and it is unrun.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const ABSENT = 'definitelyNotIndexedSymbolXyz';
const ALL_TYPE_VERBS = [
  { verb: 'graph_callers', module: 'callers.js', fn: 'graphCallers' },
  { verb: 'graph_callees', module: 'callees.js', fn: 'graphCallees' },
  { verb: 'graph_impact', module: 'impact.js', fn: 'graphImpact' },
];
const STALE_FACT = /behind HEAD|staleness could NOT be determined/i;

let fresh;
let stale;

async function ask(repo, module, fn) {
  const mod = await import(`../../../mcp/stdio/query/verbs/${module}`);
  return String(await mod[fn]({ repoRoot: repo, symbol: ABSENT }));
}

function makeRepo(name) {
  const repo = mkdtempSync(join(tmpdir(), name));
  cpSync(join(ROOT, 'tests/fixtures/identity-hostile'), repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base');
  return { repo, git };
}

beforeAll(async () => {
  const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');

  fresh = makeRepo('apg-nomatch-fresh-');
  await ensureFresh({ repoRoot: fresh.repo });

  stale = makeRepo('apg-nomatch-stale-');
  await ensureFresh({ repoRoot: stale.repo });
  // Move HEAD PAST the indexed commit without reindexing. This is what makes the staleness fact
  // true; on the fresh repo the same caveat is correctly silent.
  writeFileSync(join(stale.repo, 'src', 'later.cpp'), 'int later() { return 7; }\n');
  stale.git('add', '-A'); stale.git('commit', '-qm', 'after the index');
}, 240_000);

afterAll(() => {
  for (const r of [fresh, stale]) if (r?.repo) rmSync(r.repo, { recursive: true, force: true });
});

describe('a NO MATCH names the population it searched', () => {
  it('POSITIVE CONTROL: the symbol really is absent, from a POPULATED graph', async () => {
    // A NO MATCH from an empty graph is a different (and correct) answer, and would make every row
    // below an artefact of an unbuilt index rather than a property of the message.
    const { openExistingDb } = await import('../../../mcp/stdio/storage/db.js');
    const db = openExistingDb(join(fresh.repo, '.aify-graph', 'graph.sqlite'));
    try {
      expect(db.get('SELECT COUNT(*) AS c FROM nodes')?.c ?? 0).toBeGreaterThan(0);
    } finally { db.close?.(); }
    expect(await ask(fresh.repo, 'callers.js', 'graphCallers')).toContain('NO MATCH');
  }, 120_000);

  for (const v of ALL_TYPE_VERBS) {
    it(`★★★ ${v.verb} ties its NO MATCH to index staleness when the index IS stale`, async () => {
      const text = await ask(stale.repo, v.module, v.fn);
      expect(text, 'still a NO MATCH — otherwise this says nothing about the message').toContain('NO MATCH');
      expect(text, 'a bare NO MATCH reads as a fact about the REPOSITORY').toMatch(STALE_FACT);
    }, 120_000);

    it(`${v.verb} stays SILENT on a fresh index — the caveat is not unconditional noise`, async () => {
      // ⛔ THE CONTROL THAT MAKES THE ONE ABOVE MEAN SOMETHING. A caveat printed always would pass
      // the stale assertion while telling the reader nothing, and the standard the whereis work set
      // is explicit: "a generic 'results may be incomplete' costs the reader as much as a false
      // claim — they go and check either way."
      const text = await ask(fresh.repo, v.module, v.fn);
      expect(text).toContain('NO MATCH');
      // ⚠ A LIVE matcher, not a bare not.toMatch — the repo ratchets those down, and it caught me
      // on this exact shape two cycles ago. The canaries are real strings: the caveat's own wording
      // must match, and a fresh-index answer must not.
      expectAbsentWithLiveMatcher(
        STALE_FACT,
        {
          forbidden: 'index is 2 commits behind HEAD — this symbol may be newly added',
          allowed: 'NO MATCH for "x". Try graph_search(query="x") to find similar names.',
        },
        text,
        'the staleness caveat fired on a FRESH index — that is noise, not a fact',
      );
    }, 120_000);
  }

  it('★★★ graph_change_plan names its EMPTY DECLARATION TYPES instead — a restricted population', async () => {
    // Different verb, different searched population, therefore a different measured fact. It
    // restricts to SEARCH_TYPES, so staleness is not the fact that explains its miss.
    const { buildChangePlanWithContext } = await import('../../../mcp/stdio/query/verbs/change_plan.js');
    const { openExistingDb } = await import('../../../mcp/stdio/storage/db.js');
    const db = openExistingDb(join(fresh.repo, '.aify-graph', 'graph.sqlite'));
    try {
      const text = String(await buildChangePlanWithContext(db, { symbol: ABSENT, repoRoot: fresh.repo }));
      expect(text).toContain('NO MATCH');
      expect(text, 'change_plan searches a RESTRICTED type set; its miss must name which are empty')
        .toMatch(/SEARCHED|empty|declaration types/i);
    } finally { db.close?.(); }
  }, 120_000);
});
