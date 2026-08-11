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
// What `git diff --name-only LOADED..TREE` reports. `null` makes the call throw, which is
// the "delta unknown" case rather than the "delta empty" one.
let diffFiles = ['docs/notes.md'];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (cmd, args, opts) => {
      if (cmd === 'git' && Array.isArray(args)) {
        if (args.includes('rev-parse')) return `${head}\n`;
        if (args.includes('status')) return ''; // clean tree; dirt is a separate signal
        // The stale DELTA — which files differ between the loaded commit and the tree.
        // A THROW here is not an empty delta: it is "could not be computed", which the
        // warning must treat as fail-closed rather than as nothing-changed.
        if (args.includes('diff')) {
          if (diffFiles === null) throw new Error('git diff unavailable');
          return diffFiles.join('\n');
        }
      }
      return actual.execFileSync(cmd, args, opts);
    },
  };
});

const { staleProcessWarning, serverBuildInfo, _resetServerBuildCache } = await import('../../../mcp/stdio/server-build.js');

// The module captured LOADED_COMMIT='aaaaaaa' on import above. Advancing the tree now is
// what a `git pull` in the checkout does to a server that is already running.
beforeEach(() => {
  head = 'bbbbbbb';
  diffFiles = ['docs/notes.md'];
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
    // ★★ BOTH DELTA ROUTES, because the warning has two message branches and the default
    // fixture only exercised one. dev's synonym mutant landed in the executable-delta
    // branch; my docs-only default never rendered it, so the assertion passed without ever
    // seeing the text it forbids. One route says nothing about its sibling.
    const routes = [
      { name: 'docs-only (behaviourally current)', files: ['docs/notes.md'] },
      { name: 'executable delta', files: ['mcp/stdio/query/verbs/health.js'] },
      { name: 'delta uncomputable', files: null },
    ];    const w = warning();

    // ⚠ THIS USED TO FORBID TWO EXACT PHRASINGS, and dev showed that inserting the
    // synonym "This agent is unable to restart the MCP process itself." left it GREEN.
    // A ban on two spellings is not a ban on the claim — the prohibited thing is a
    // SEMANTIC CLASS: any assertion about what the READER is or is not able to do.
    //
    // So the assertion is a class, not a list: a capability modal attached to an actor.
    // It is deliberately broad; a false positive here costs one reworded sentence, while
    // a false negative costs a reader two rounds of asking the wrong person.
    // ⚠⚠ MY FIRST REPAIR OF THIS ALSO FAILED, and the way it failed is the lesson.
    // I replaced two literal phrasings with an ACTOR-enumerating regex — you / your /
    // the agent / an agent — and dev's mutant said "THIS agent is unable to…", which my
    // list did not contain. Enumerating actors is the same mistake as enumerating
    // spellings, one level up: I keep listing members of an open class.
    //
    // ⇒ So the invariant is stated WITHOUT the actor. The warning may never pair an
    // inability modal with a restart verb, no matter who is said to be unable. There is
    // no legitimate reason for this string to contain such a pairing: whether anyone can
    // restart the process is a property of the HOST, which this server cannot know.
    const INABILITY_TO_RESTART =
      /\b(cannot|can'?t|can not|unable to|not able to|no way to|impossible to|incapable of)\b[^.]{0,60}\b(restart|respawn|reload|relaunch|cycle)\w*/i;
    expect(w, 'what anyone can do about this process is host-dependent and unknowable from here')
      .not.toMatch(INABILITY_TO_RESTART);
    // Reverse ordering, since the verb can precede the modal ("restarting … is not possible").
    expect(w).not.toMatch(/\b(restart|respawn|relaunch)\w*\b[^.]{0,60}\b(is|are)\s+(not|im)?possible\b/i);
    expect(w, 'must not route to a single fixed actor').not.toMatch(/ask your operator to/i);
    for (const route of routes) {
      diffFiles = route.files;
      _resetServerBuildCache();
      const rw = warning();
      expect(rw, `[${route.name}] no inability-to-restart claim`).not.toMatch(INABILITY_TO_RESTART);
      expect(rw, `[${route.name}] no fixed actor`).not.toMatch(/ask your operator to/i);
      expect(rw, `[${route.name}] the invariant it CAN assert: the process, not the files`)
        .toMatch(/this PROCESS must be restarted/);
    }
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

    // ⚠⚠ TWO SATISFIERS FOUND HERE, BOTH BY ME BEING TOO CLEVER WITH REGEXES.
    //
    // (1) An unanchored /\d{4}-\d{2}-\d{2}T/ was satisfied by a DIFFERENT ISO instant
    //     further along the warning. Anchoring to the label fixed that one.
    // (2) graph-senior-dev-hermes then replaced the interpolation with a FABRICATED fixed
    //     instant (2000-01-01T00:00:00.000Z) and the anchored regex stayed GREEN — because
    //     a regex can only ever grant FORMAT credit. Shape is not identity.
    //
    // ⇒ So the value is compared to an INDEPENDENT AUTHORITY: the same process identity
    // the server exposes as `startedAt`. A fabricated instant differs from it; a pointer
    // to it is not a value at all. Neither can pass.
    const authority = serverBuildInfo().startedAt;
    expect(authority, 'harness sanity: the server must expose a process identity').toBeTruthy();
    expect(w, 'the label must carry the REAL process-start instant, not an ISO-shaped one')
      .toContain(`PROCESS STARTED: ${authority}`);
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

  // ★★ MOVED HERE 2026-08-11 from degraded-split-persistence.test.js, whose last two cases
  // were about this module rather than about code-intel. They were three regexes over
  // server-build.js; the git mock above already reproduces the real condition, so they
  // become behaviour at no extra cost — and they belong beside the warning they qualify.
  //
  // The defect: staleProcess said RESTART whether the delta was a guard preventing data
  // loss or a single markdown file. ef-manager hit exactly that — loaded cad4569 vs tree
  // c526849, and the entire delta was one doc. He had to run `git diff --name-only`
  // himself to learn the running server was behaviourally current.
  describe('the delta distinguishes a doc change from a behaviour change', () => {
    it('★★ a docs-only delta is called BEHAVIOURALLY CURRENT', () => {
      diffFiles = ['docs/notes.md', 'README.md'];
      _resetServerBuildCache();

      expect(warning(), 'the process is behind, but not in any way that runs')
        .toMatch(/BEHAVIOURALLY CURRENT and a restart is not/);
    });

    it('★★ one executable file in the delta withdraws that reassurance', () => {
      diffFiles = ['docs/notes.md', 'mcp/stdio/query/verbs/health.js'];
      _resetServerBuildCache();
      const w = warning();

      expect(w, 'a .js in the delta means the running code differs')
        .not.toMatch(/BEHAVIOURALLY CURRENT/);
      expect(w).toMatch(/delta includes 1 executable file/);
    });

    it('★ an UNCOMPUTABLE delta fails closed, not open', () => {
      // The whole point of the classifier is to let a reader ignore a doc-only drift. That
      // makes "unknown" dangerous in exactly one direction, so unknown must read as
      // "assume it matters" — a fail-closed default is a prompt to go measure, not a
      // resting state.
      diffFiles = null; // the git call throws
      _resetServerBuildCache();
      const w = warning();

      expect(w).toMatch(/Delta could not be computed, so assume it matters/);
      expect(w, 'silence about the delta must never read as reassurance')
        .not.toMatch(/BEHAVIOURALLY CURRENT/);
    });
  });
});
