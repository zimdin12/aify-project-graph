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
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11 — this is the follow-up the previous
// version named as its own real fix, and it is the LAST of the eighteen.
//
// The old file read server-build.js as text and needed a two-stage normaliser to do it:
// strip comment lines (because a comment quoting the old wording failed a `.not.toMatch`),
// then collapse `' +\n '` joins (because splitting a string across a concatenation broke a
// phrase assertion while the emitted bytes were identical). It broke TWICE on 2026-08-11,
// both times inside the fix for its own defect, and neither break was a behaviour change.
//
// Both of those failures are impossible here: `staleProcessWarning()` returns the string a
// reader actually receives. Comments are not in it, and concatenation is already done.
//
// ⚠ What this still cannot ask is IS THE SENTENCE TRUE — no test can. That limit is why
// the first case below asserts an ABSENCE of host claims rather than the presence of any
// particular advice: the class of bug was a true-sounding claim about the reader's
// environment, and the only durable defence is to not make claims about it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The staleness verdict is `LOADED_COMMIT !== treeCommit`, where LOADED_COMMIT is captured
// when the module is first imported and treeCommit is read on every call. Moving `head`
// between those two moments is exactly the real condition: a process running one commit
// while the checkout has advanced. Nothing here fakes the warning — the module derives a
// genuine stale verdict and emits its own text.
let head = 'aaaaaaa';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (cmd, args, opts) => {
      if (cmd === 'git' && Array.isArray(args)) {
        if (args.includes('rev-parse')) return `${head}\n`;
        if (args.includes('status')) return ''; // clean tree; dirt is a separate signal
      }
      return actual.execFileSync(cmd, args, opts);
    },
  };
});

const { staleProcessWarning, _resetServerBuildCache } = await import('../../../mcp/stdio/server-build.js');

// The module captured LOADED_COMMIT='aaaaaaa' on import above. Advancing the tree now is
// what a `git pull` in the checkout does to a server that is already running.
beforeEach(() => {
  head = 'bbbbbbb';
  _resetServerBuildCache(); // the verdict is TTL-cached; a stale cache would hide the move
});

afterEach(() => {
  head = 'aaaaaaa';
  _resetServerBuildCache();
});

const warning = () => {
  const w = staleProcessWarning();
  expect(w, 'harness sanity: the moved tree must produce a stale verdict').toBeTruthy();
  return w;
};

describe('the stale warning is actionable by whoever reads it', () => {
  it('★★ makes NO capability claim about the host — only what this server can know', () => {
    // ⛔ THIS CASE USED TO PIN A FALSE STATEMENT AND DEFEND IT AGAINST CORRECTION.
    //
    // It asserted /an agent cannot self-restart/ and /ask your operator/. That claim is
    // false in this deployment — a peer agent can restart a managed session via
    // aify-comms `comms_restart`. ef-manager read the warning, believed it, and asked the
    // operator twice to do something they could have done in one call.
    //
    // ★ The general form, worth more than the fix: PROSE CAN CARRY FACTUAL CLAIMS, AND
    // FACTS GO STALE. A wording contract pins whatever assertions the phrasing carries and
    // defends them against correction — this case would have gone RED on the fix.
    // Mutation cannot catch the class either: no mutation of code makes a false sentence
    // false-er. Only a reader acting on wrong advice finds it.
    //
    // ⇒ So the assertion is inverted, and it is inverted on the EMITTED string now rather
    // than on the source, which is what makes it a claim about what a reader receives.
    const w = warning();

    expect(w, 'what an agent can do is host-dependent and unknowable from here')
      .not.toMatch(/an agent cannot self-restart/i);
    expect(w, 'must not route to a single fixed actor').not.toMatch(/ask your operator to/i);
    expect(w, 'the invariant it CAN assert: the process, not the files')
      .toMatch(/this PROCESS must be restarted/);
  });

  it('★ warns that a session restart may not respawn the MCP child', () => {
    // The failure mode that cost two rounds: comms_restart cycled the worker and
    // left the MCP child serving code from first launch.
    expect(warning()).toMatch(/cycle the agent worker WITHOUT respawning/);
  });

  it('★★ carries the ACTUAL start timestamp, not just the words PROCESS STARTED', () => {
    // The wrong-referent fix, asserted at the level the reader uses it. A label with no
    // value behind it is the same dead end as pointing at `commit`: the discriminator
    // only works if there is a timestamp to compare across a restart attempt.
    const w = warning();

    // ⚠ The instant must be anchored TO THE LABEL. An unanchored /\d{4}-\d{2}-\d{2}T/
    // was the first thing written here and it survived replacing the interpolation with
    // the literal text "(see server.startedAt)" — because the warning carries another
    // ISO timestamp further along. A regex that can be satisfied by a different field is
    // the vacuous-assertion shape this suite keeps finding in itself.
    expect(w, 'the label must be followed by the instant itself, not a pointer to it')
      .toMatch(/PROCESS STARTED: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(w).toMatch(/timestamp is unchanged, the restart did not reach/);
  });

  it('★ says explicitly that commit alone cannot answer it', () => {
    // Without this the next reader repeats the loop: retry the restart, re-read the same
    // hash, conclude nothing. This is the sentence that names the wrong referent.
    expect(warning()).toMatch(/indistinguishable by commit alone/);
  });

  it('★ stays SILENT when the process matches the tree', () => {
    // The other half, and the one a source-grep could never check: a warning that fires
    // unconditionally teaches readers to ignore it, which costs more than saying nothing.
    head = 'aaaaaaa'; // back to the commit this module loaded
    _resetServerBuildCache();

    expect(staleProcessWarning(), 'no drift, no warning').toBeNull();
  });
});
