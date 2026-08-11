// A WARNING WHOSE READER CANNOT ACT ON IT IS HALF A WARNING.
//
// Two failures from the same string, both found by ef-manager (2026-08-09/10) by
// being blocked by it twice in two sessions:
//
// 1. It said "RESTART the aify-project-graph MCP server." Correct for an operator,
//    impossible for an agent — the host spawns the server at session start, and
//    killing it drops the connection rather than reloading. The agent is the one
//    who reads the string and the one who cannot perform it.
//
// 2. I told them to verify the restart by checking `server.commit`. That field
//    CANNOT answer "did a restart occur" — after a failed restart it reads exactly
//    the same as after a successful restart onto the same code. Their startedAt
//    held at 15:37:34.353Z across seven hours, three commits and a restart attempt,
//    which is what actually proved the process never cycled.
//
// The second is the sharper one: it is the wrong-referent pattern again — a true
// check bound to a question it cannot answer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const rawSrc = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'server-build.js'),
  'utf8',
);

// ★ NORMALISE BEFORE ASSERTING — this file broke TWICE on 2026-08-11, both times
// inside the fix for its own defect, and neither break was a behaviour change:
//
//   1. a `.not.toMatch` failed because a COMMENT quoted the old wording. A source
//      regex cannot tell a comment from emitted code.
//   2. a phrase assertion failed because the string was split across a `+`
//      concatenation. The emitted text was byte-identical; only the source moved.
//
// So: strip comments, then collapse `' + '` joins, so what is matched approximates
// what a READER receives rather than how it happens to be laid out.
//
// ⚠ This is mitigation, not a cure. It is still source-anchored, and it still cannot
// ask the question that actually bit us — IS THE SENTENCE TRUE? A wording contract
// pins whatever claims the wording carries and defends them against correction. The
// real fix is a seam that emits the warning for a fixture, and it is the follow-up.
const src = rawSrc
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join('\n')
  .replace(/'\s*\n\s*\+\s*'/g, '');

describe('the stale warning is actionable by whoever reads it', () => {
  it('★★ asserts NO capability claim about the host — only what this server can know', () => {
    // ⛔ THIS CASE USED TO PIN A FALSE STATEMENT AND DEFEND IT AGAINST CORRECTION.
    //
    // It asserted /an agent cannot self-restart/ and /ask your operator/. That claim is
    // false in this deployment — a peer agent can restart a managed session via
    // aify-comms `comms_restart`. ef-manager read the warning, believed it, and asked the
    // operator twice to do something they could have done in one call.
    //
    // ★ And this file was the ONE of eighteen source-contract tests judged LEGITIMATE,
    // on the reasoning that advisory prose has no computation behind it so a fixture
    // would add nothing. The flaw is general and it is the reason this comment is long:
    // PROSE CAN CONTAIN FACTUAL CLAIMS, AND FACTS GO STALE. A wording contract pins
    // whatever assertions the phrasing carries — so this case would have gone RED on a
    // correction, actively protecting the false sentence.
    //
    // ⚠ Mutation cannot catch this class either: no mutation of code makes a false
    // sentence false-er. Only a reader acting on wrong advice finds it.
    //
    // So the assertion is inverted. Whether the reader can restart the process is a
    // property of the HOST, which this server cannot know, and it must not claim to.
    expect(src, 'must not assert what an agent can or cannot do — that is host-dependent')
      .not.toMatch(/an agent cannot self-restart/);
    expect(src, 'must not route to a single fixed actor').not.toMatch(/ask your operator to/);
    // What IS invariant and must be said: the PROCESS is what needs restarting.
    expect(src).toMatch(/this PROCESS must be restarted/);
  });

  it('★ warns that a session restart may not respawn the MCP child', () => {
    // The failure mode that cost two rounds: comms_restart cycled the worker and
    // left the MCP child serving code from first launch.
    expect(src).toMatch(/cycle the agent worker WITHOUT respawning/);
  });

  it('★ surfaces PROCESS STARTED as the restart discriminator', () => {
    expect(src).toMatch(/PROCESS STARTED/);
    expect(src).toMatch(/timestamp is unchanged, the restart did not reach/);
  });

  it('★ says explicitly that commit alone cannot answer it', () => {
    // Without this the next reader repeats the loop: retry the restart, re-read
    // the same hash, conclude nothing.
    expect(src).toMatch(/indistinguishable by commit alone/);
  });
});
