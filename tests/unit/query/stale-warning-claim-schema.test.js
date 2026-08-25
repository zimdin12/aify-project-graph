// THE CLAIMS ARE THE CONTRACT; THE PROSE IS A RENDERING.
//
// review, hermes session's design, after four rounds proved prose cannot police itself.
// A blacklist over natural language is never finished (an open class), and an equality
// check against a hand-written copy is defeated by editing subject and expectation in one
// patch — which they demonstrated.
//
// ⇒ What is asserted here is the CLAIM SEQUENCE, not the sentence. Adding an assertion to
// the warning requires adding a claim ID: enumerable, legible in a diff, testable as an
// ordered set. A sentence appended inside a template literal is none of those.
//
// ★★ THE LIMIT, stated because the reviewer asked for it and because overclaiming here would be
// the exact defect the warning exists to prevent: this gives CHANGE VISIBILITY, not
// independent semantic authorization. A contributor editing the schema and this test
// together still authorises themselves.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CLAIM, ROUTE_CLAIMS, FORBIDDEN_CLAIM_CLASSES, renderClaim, routeForDelta,
} from '../../../mcp/stdio/stale-warning-claims.js';

let head = 'aaaaaaa';
let diffFiles = ['docs/notes.md'];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (cmd, args, opts) => {
      if (cmd === 'git' && Array.isArray(args)) {
        if (args.includes('rev-parse')) return `${head}\n`;
        if (args.includes('status')) return '';
        if (args.includes('diff')) {
          if (diffFiles === null) throw new Error('git diff unavailable');
          return diffFiles.join('\n');
        }
      }
      return actual.execFileSync(cmd, args, opts);
    },
  };
});

const { staleProcessWarning, serverBuildInfo, _resetServerBuildCache } =
  await import('../../../mcp/stdio/server-build.js');

beforeEach(() => { head = 'bbbbbbb'; diffFiles = ['docs/notes.md']; _resetServerBuildCache(); });
afterEach(() => { head = 'aaaaaaa'; _resetServerBuildCache(); });

describe('the stale warning renders a closed set of typed claims', () => {
  // ⛔ SELF-REVIEW SURVIVOR M1 — THE REGISTRY-DERIVED-ARMS TRAP, THIRD TIME TODAY.
  //
  // The ordering case below iterates ROUTE_CLAIMS, so DELETING a claim from a route simply
  // makes it check fewer fragments: my own mutation dropped
  // SESSION_RESTART_MAY_NOT_RESPAWN from docs_only and the file stayed green. Same shape as
  // deriving classifier arms from the production registry, and as importing the approved
  // prose fragment from the module under test.
  //
  // ⇒ A HAND-WRITTEN sequence is the ratchet. Changing what a route asserts now takes two
  // edits in different places, which is the conscious act the schema exists to force.
  const EXPECTED_CLAIMS = {
    docs_only: [
      'process_is_stale', 'delta_non_executable', 'process_restart_required',
      'host_method_unknown', 'session_restart_may_not_respawn',
      'verify_by_started_at', 'commit_not_restart_identity',
    ],
  };

  it('★★ the route\'s claim sequence matches the hand-approved list exactly', () => {
    expect(ROUTE_CLAIMS.docs_only, 'a claim may not silently leave or join a route')
      .toEqual(EXPECTED_CLAIMS.docs_only);
  });

  it('★★ every claim the schema declares for a route APPEARS, in order', () => {
    // Order is part of the contract: the verification step must follow the instruction it
    // verifies, or a reader acts before being told how to check whether it worked.
    const w = staleProcessWarning();
    expect(w, 'harness sanity: the moved tree must produce a warning').toBeTruthy();

    const rendered = ROUTE_CLAIMS.docs_only
      .map((id) => renderClaim(id, { startedAt: serverBuildInfo().startedAt }))
      .filter(Boolean);
    expect(rendered.length, 'harness sanity: the route must render some claims')
      .toBeGreaterThan(3);

    let cursor = -1;
    for (const fragment of rendered) {
      const at = w.indexOf(fragment);
      expect(at, `claim fragment must be present: ${JSON.stringify(fragment.slice(0, 50))}`)
        .toBeGreaterThan(-1);
      expect(at, 'claims must appear in the declared order').toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('★★ the FORBIDDEN classes are named in the schema, not left to a regex', () => {
    // All four review failures were instances of these two classes. Naming them makes the
    // prohibition a property of the contract rather than of a filter someone widens after
    // each new phrasing gets through.
    expect(FORBIDDEN_CLAIM_CLASSES).toContain('host_actor_capability');
    expect(FORBIDDEN_CLAIM_CLASSES).toContain('host_actor_permission');

    // And no declared CLAIM may belong to a forbidden class — the schema must not declare
    // something it also forbids.
    for (const id of Object.values(CLAIM)) {
      expect(FORBIDDEN_CLAIM_CLASSES, `claim ${id} must not be a forbidden class`)
        .not.toContain(id);
    }
  });

  it('★★ an unknown claim id renders NOTHING — a typo cannot emit prose', () => {
    // A default that returned text would put an unreviewed sentence in front of a reader
    // whenever someone mistyped an id.
    expect(renderClaim('not_a_real_claim')).toBe('');
    expect(renderClaim(undefined)).toBe('');
    expect(renderClaim(null)).toBe('');
  });

  it('★★ the dynamic authority is BOUND, not baked into the sentence', () => {
    // Separates two claims that were fused: that the sentence says the right thing, and
    // that the value in it is the real process identity. dev broke the old version with a
    // fabricated instant that still matched the shape.
    expect(renderClaim(CLAIM.VERIFY_BY_STARTED_AT, { startedAt: '2020-01-02T03:04:05.678Z' }))
      .toContain('2020-01-02T03:04:05.678Z');

    expect(staleProcessWarning()).toContain(`PROCESS STARTED: ${serverBuildInfo().startedAt}`);
  });

  it('★ the route classification is separable from the rendering', () => {
    // They were fused, so a wrong classification and a wrong sentence were one failure.
    expect(routeForDelta({ behaviourally_current: true })).toBe('docs_only');
    expect(routeForDelta({ behaviourally_current: false })).toBe('executable_delta');
    expect(routeForDelta(null), 'an uncomputable delta is its own route').toBe('delta_unknown');
    expect(Object.keys(ROUTE_CLAIMS).sort())
      .toEqual(['delta_unknown', 'docs_only', 'executable_delta']);
  });
});
