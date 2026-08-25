import { describe, it, expect } from 'vitest';
import {
  classifyInstallation,
  summariseDeployment,
  detectShadowRoots,
  DEPLOYMENT_STATES,
} from '../../../scripts/lib/skill-deployment.mjs';

// ⛔ SYNCING IS NOT DEPLOYING, AND I LEARNED THAT BY GETTING IT WRONG TODAY.
//
//     repo      integrations/claude-code/skill/SKILL.md   34,212 bytes
//     INSTALLED ~/.claude/skills/aify-project-graph/      26,963 bytes
//
// `sync-skills.mjs` mirrors WITHIN the repo across the four runtime trees and reports
// "deployment: all 16 shipped skills present" — a PRESENCE check, not a content check, and not a
// deploy at all. The installed skill an agent actually reads was ~7KB behind and did not contain
// the text I had just written.
//
// ⛔⛔ AND IT SILENTLY INVALIDATED A MEASUREMENT. Earlier the same day I counted invocations of
// INSTALLED skills and reasoned about what our skills SAY — content that existed only in the repo.
// The counts stood; every inference about content did not.
//
// ⇒ Review ruling: deployment/readback is its own step. Enumerate the declared population, update
// each target, then READ BACK exact bytes — and report missing/inaccessible/stale as TYPED
// NON-SUCCESS rather than collapsing them into zero or excluding them once the results are visible.

const src = (bytes, mtimeMs = 2000) => ({ path: 'src/SKILL.md', bytes, mtimeMs });
const inst = (bytes, mtimeMs = 1000) => ({ path: 'i', bytes, mtimeMs });

describe('classifyInstallation — every outcome is a NAMED state, never a silent zero', () => {
  it('identical bytes are a match', () => {
    const r = classifyInstallation({ source: src('hello'), installed: inst('hello') });
    expect(r.state).toBe('match');
    expect(r.ok).toBe(true);
  });

  it('⭐ THE HOSTILE CONTROL — source NEWER than installed is STALE, not a match', () => {
    // This is the exact defect that shipped: the repo moved, the installation did not, and every
    // presence check stayed green because the file existed. A deployment checker that cannot see
    // this is the one we already had.
    const r = classifyInstallation({
      source: src('hello world, with the new paragraph'),
      installed: inst('hello world'),
    });
    expect(r.state).toBe('stale');
    expect(r.ok).toBe(false);
    expect(r.sourceBytes).toBeGreaterThan(r.installedBytes);
  });

  it('⛔ INSTALLED NEWER than source is its own state, not folded into stale', () => {
    // Different cause, different remedy: someone edited the installed copy by hand, or the deploy
    // ran from a newer tree than this checkout. Calling it "stale" would send the reader to the
    // wrong fix.
    const r = classifyInstallation({ source: src('short'), installed: inst('much longer installed text', 9000) });
    expect(r.state).toBe('diverged');
    expect(r.ok).toBe(false);
  });

  it('⛔⛔ REGRESSION — source NEWER but SMALLER is STALE. Size is not recency.', () => {
    // ⛔ THIS IS THE DEFECT THE FIRST VERSION SHIPPED, caught on its first run against reality.
    // `find-the-doc` came back `diverged` — installed 5,047 bytes vs source 5,042 — because the
    // source had just been SHORTENED (a ten-character word replaced by a five-character one). The
    // classifier read "smaller" as "behind" and told the reader to inspect for a hand-edit that
    // never happened, while refusing a deploy that was correct.
    //
    // ⇒ Content decides EQUALITY; mtime decides DIRECTION. Neither can do the other's job, and the
    // wrong verdict was the confident-looking one.
    const r = classifyInstallation({
      source: src('my agent asked me', 5000),          // newer, and SHORTER
      installed: inst('my sc-manager asked me', 1000),
    });
    expect(r.state).toBe('stale');
    expect(r.ok).toBe(false);
    expect(r.sourceBytes).toBeLessThan(r.installedBytes);   // the trap, pinned explicitly
  });

  it('⛔ NO usable clock REFUSES to guess a direction rather than asserting one', () => {
    // Fail closed. Inventing a direction from size is exactly what produced the wrong verdict.
    const r = classifyInstallation({
      source: { path: 's', bytes: 'aaa' },
      installed: { path: 'i', bytes: 'b' },
    });
    expect(r.state).toBe('diverged');
    expect(r.detail).toMatch(/no comparable mtime/i);
  });

  it('⛔ a MISSING installation is reported, never treated as nothing to do', () => {
    const r = classifyInstallation({ source: src('hello'), installed: null });
    expect(r.state).toBe('missing');
    expect(r.ok).toBe(false);
  });

  it('⛔ an UNREADABLE installation is its own state — not missing, not a match', () => {
    // A permissions failure that reads as "missing" invites a deploy that will also fail; one that
    // reads as "match" is a fail-open lie. It has to be its own answer.
    const r = classifyInstallation({ source: src('hello'), installed: { path: 'i', error: 'EACCES', mtimeMs: 1000 } });
    expect(r.state).toBe('unreadable');
    expect(r.ok).toBe(false);
  });

  it('⭐ the state vocabulary is DECLARED, so a consumer can switch on it exhaustively', () => {
    expect([...DEPLOYMENT_STATES].sort()).toEqual(['diverged', 'match', 'missing', 'stale', 'unreadable']);
    // And every declared state must be reachable — a vocabulary entry no input can produce is the
    // dead-branch defect this repo shipped once already (a cause value no input could emit).
    const produced = new Set([
      classifyInstallation({ source: src('a'), installed: inst('a') }).state,
      classifyInstallation({ source: src('ab'), installed: inst('a') }).state,
      classifyInstallation({ source: src('a'), installed: inst('ab', 9000) }).state,
      classifyInstallation({ source: src('a'), installed: null }).state,
      classifyInstallation({ source: src('a'), installed: { path: 'i', error: 'EACCES', mtimeMs: 1000 } }).state,
    ]);
    expect([...produced].sort()).toEqual([...DEPLOYMENT_STATES].sort());
  });
});

describe('detectShadowRoots — a second install root can silently shadow the one you deployed to', () => {
  // ⛔ MEASURED ON THIS MACHINE, and it falsified my own report. I told the reviewer the non-Claude
  // runtimes had an EMPTY declared population. They do not: Codex has 14 of our skills installed
  // and Hermes has 14 across TWO roots at DIFFERENT vintages —
  //
  //     ~/.hermes/skills/...              26,012 bytes
  //     $HERMES_HOME/skills/...           26,963 bytes
  //
  // Which one Hermes reads depends on an environment variable. Deploying to one and reporting
  // "in sync" is a claim about a file, not about what an agent will load.
  const exists = (set) => (p) => set.includes(p);

  it('⭐ reports an alternate root that exists alongside the selected one', () => {
    const r = detectShadowRoots({
      selected: '/appdata/hermes/skills',
      candidates: ['/appdata/hermes/skills', '/home/.hermes/skills'],
      existsFn: exists(['/appdata/hermes/skills', '/home/.hermes/skills']),
    });
    expect(r.shadows).toEqual(['/home/.hermes/skills']);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/shadow/i);
  });

  it('a candidate that does NOT exist is not a shadow', () => {
    const r = detectShadowRoots({
      selected: '/appdata/hermes/skills',
      candidates: ['/appdata/hermes/skills', '/home/.hermes/skills'],
      existsFn: exists(['/appdata/hermes/skills']),
    });
    expect(r.shadows).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('⭐ USED AS A COVERAGE CONTROL — an existing root that is NOT a deploy target is a defect', () => {
    // ⛔ THIS IS HOW PRODUCTION CALLS IT NOW, and the earlier tests did not cover this shape.
    //
    // The first design deployed to ONE "selected" root per runtime and WARNED about the others.
    // The operator rejected that: the warning was unactionable, and it left a genuinely stale copy
    // on disk — ~/.hermes/skills at 26,012 bytes against a 34,212-byte source, with three skills
    // never installed there at all. Every live root is now a TARGET instead, so the two Hermes
    // directories cannot drift apart and it stops mattering which one the runtime reads.
    //
    // ⇒ With all live roots covered, an uncovered candidate should be IMPOSSIBLE — so this asserts
    // it rather than assuming it, and the run FAILS instead of printing a caveat nobody can act on.
    const allRoots = ['/a/skills', '/b/skills'];
    const covered = ['/a/skills', '/b/skills'];
    const clean = detectShadowRoots({
      selected: null,
      candidates: allRoots,
      existsFn: (p) => allRoots.includes(p) && !covered.includes(p),
    });
    expect(clean.shadows, 'every live root is a target, so nothing is uncovered').toEqual([]);
    expect(clean.ok).toBe(true);

    // And it must be able to SAY NO: a root that exists but was left out of the target list.
    const missed = detectShadowRoots({
      selected: null,
      candidates: allRoots,
      existsFn: (p) => allRoots.includes(p) && !['/a/skills'].includes(p),
    });
    expect(missed.shadows, 'a live root left out of the deploy targets must surface').toEqual(['/b/skills']);
    expect(missed.ok).toBe(false);
  });

  it('⛔ the SELECTED root is never reported as shadowing itself', () => {
    // A self-shadow would make every deployment permanently caveated and train the reader to
    // ignore the field — the boy-who-cried-wolf failure that makes a real warning invisible.
    const r = detectShadowRoots({
      selected: '/a/skills',
      candidates: ['/a/skills'],
      existsFn: exists(['/a/skills']),
    });
    expect(r.shadows).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe('summariseDeployment — FAILS CLOSED, and cannot drop a row after seeing it', () => {
  const row = (state) => ({ name: `s-${state}`, state, ok: state === 'match' });

  it('all matches is the only success', () => {
    const s = summariseDeployment([row('match'), row('match')]);
    expect(s.ok).toBe(true);
    expect(s.total).toBe(2);
  });

  it('⛔ ONE stale row fails the whole deployment', () => {
    const s = summariseDeployment([row('match'), row('stale')]);
    expect(s.ok).toBe(false);
    expect(s.byState.stale).toBe(1);
  });

  it('⛔ every non-success state fails it — none is treated as benign', () => {
    for (const bad of ['stale', 'missing', 'unreadable', 'diverged']) {
      expect(summariseDeployment([row('match'), row(bad)]).ok, bad).toBe(false);
    }
  });

  it('⭐ the counts add up to the input — nothing is excluded from the denominator', () => {
    // "Do not collapse them into zero or exclude them after seeing results." A summary whose parts
    // do not sum to its total has dropped a row, which is how an inconvenient failure disappears.
    const rows = [row('match'), row('stale'), row('missing'), row('unreadable'), row('diverged')];
    const s = summariseDeployment(rows);
    expect(Object.values(s.byState).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(s.total).toBe(rows.length);
    expect(s.failures.map((f) => f.name).sort()).toEqual(
      rows.filter((r) => !r.ok).map((r) => r.name).sort(),
    );
  });

  it('⛔ an EMPTY population is NOT success — it is the vacuous-truth trap', () => {
    // `[].every()` is true. This repo has already had a wired gate certify its own failure that
    // way, with 61 of 61 rows inert and health asserted. Zero installations to check means the
    // enumeration found nothing, which is a finding, not a pass.
    const s = summariseDeployment([]);
    expect(s.ok).toBe(false);
    expect(s.reason).toMatch(/no installations/i);
  });
});
