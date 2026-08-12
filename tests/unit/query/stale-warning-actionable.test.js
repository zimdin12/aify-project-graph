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
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

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

const { staleProcessWarning, serverBuildInfo, EXECUTABLE_EXTENSIONS, RESTART_GUIDANCE, _resetServerBuildCache } = await import('../../../mcp/stdio/server-build.js');

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

// ⛔ THE APPROVAL MUST NOT COME FROM THE THING BEING APPROVED.
//
// My first closed-set attempt imported RESTART_GUIDANCE from server-build and compared the
// emitted warning against it. dev's mutant appends its sentence to that very constant — so
// production and the approval moved together and the check stayed GREEN. A contract that
// derives its expectation from its subject cannot constrain the subject.
//
// ★ Exactly the trap dev named for the classifier table (deriving arms from the production
// registry means shrinking the registry shrinks the test set), one level up and in prose.
// I applied the lesson there and then rebuilt the same hole here within the hour.
//
// ⇒ This is a HAND-WRITTEN copy. Changing the guidance now requires editing it in two
// places — production and here — which is the conscious decision the ratchet exists to
// force. Any sentence added to the paragraph, anywhere, by anyone, fails.
const APPROVED_RESTART_GUIDANCE =
  ' TO CLEAR IT: this PROCESS must be restarted; reloading files or re-running the tool'
  + ' will not do it. How to restart depends on your host (an operator /mcp reconnect or'
  + ' CLI relaunch; in some deployments a peer agent can restart a managed session'
  + ' directly). A session-level restart may cycle the agent worker WITHOUT respawning'
  + ' this MCP child, so verify with the timestamp below rather than assuming it worked.';

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
    // ⚠⚠ THIS CASE HAS NOW FAILED THREE WAYS, each one a different reviewer mutant, and
    // the sequence is the whole lesson:
    //
    //  1. It forbade TWO EXACT PHRASINGS. dev inserted the synonym "This agent is unable
    //     to restart the MCP process itself." → still green. A ban on two spellings is
    //     not a ban on the claim.
    //  2. I replaced them with an ACTOR-enumerating regex — you / your / the agent /
    //     an agent — and their mutant said "THIS agent". Enumerating actors is the same
    //     mistake one level up: I kept listing members of an open class.
    //  3. The rewrite that finally had the right semantics was UNRUNNABLE: a `\b` written
    //     through a python heredoc became a literal backspace byte, so the regex matched
    //     a control character that appears in no output. Green, twice, for a third
    //     unrelated reason — and I twice concluded my semantics were wrong.
    //
    // ⇒ Three defences, because each failure needed a different one:
    //   · the invariant is stated with NO ACTOR — the warning may never pair an inability
    //     modal with a restart verb, whoever is said to be unable. Whether anyone can
    //     restart this process is a property of the HOST, which the server cannot know.
    //   · every route is exercised, because the warning has three delta branches and the
    //     default fixture only ever rendered one, so it never saw the text it forbids.
    //   · the matcher must match a forbidden canary before it is trusted (liveness).
    const routes = [
      { name: 'docs-only (behaviourally current)', files: ['docs/notes.md'] },
      { name: 'executable delta', files: ['mcp/stdio/query/verbs/health.js'] },
      { name: 'delta uncomputable', files: null },
    ];
    const INABILITY_TO_RESTART =
      /\b(cannot|can'?t|can not|unable to|not able to|no way to|impossible to|incapable of)\b[^.]{0,60}\b(restart|respawn|reload|relaunch|cycle)\w*/i;
    for (const route of routes) {
      diffFiles = route.files;
      _resetServerBuildCache();
      const rw = warning();

      // ★★ THE CLOSED-SET CHECK, which is what actually closes this class.
      //
      // Everything below is a BLACKLIST, and a blacklist over natural language is never
      // finished — this case has now failed three reviews to three sentences no previous
      // filter anticipated, most recently dev's "Only a human operator is permitted to
      // restart this service." (a false host-capability claim containing no inability
      // modal at all, so every regex here missed it).
      //
      // ⇒ The restart guidance must be EXACTLY the approved fragment. Any added sentence —
      // synonym, novel phrasing, or a claim nobody has imagined — changes the string and
      // fails here, without anyone having to predict it. The regexes below are kept as
      // cheap early diagnostics that name WHAT went wrong; this is the one that cannot be
      // walked around.
      expect(rw, `[${route.name}] the restart guidance must be the approved fragment, verbatim`)
        .toContain(APPROVED_RESTART_GUIDANCE);

      // ⚠ CONTAINMENT ALONE IS NOT CLOSURE — an extra sentence can sit either side of an
      // intact fragment, which is exactly what dev's mutant did. So the guidance's
      // boundaries are pinned: it must be immediately followed by the PROCESS STARTED
      // sentence, and the warning must end with the commit-cannot-answer-it sentence.
      // Together those close the two insertion points that matter.
      const at = rw.indexOf(APPROVED_RESTART_GUIDANCE);
      expect(rw.slice(at + APPROVED_RESTART_GUIDANCE.length), `[${route.name}] nothing may be inserted after the guidance`)
        .toMatch(/^ PROCESS STARTED: /);
      expect(rw.endsWith('indistinguishable by commit alone.'),
        `[${route.name}] nothing may be appended after the final sentence`).toBe(true);

      // ★★ BIDIRECTIONAL LIVENESS before the prohibition is trusted. The forbidden canary
      // is the reviewer's own mutant text, so this matcher cannot be green unless it
      // would really have caught it — which is exactly what a literal-backspace `\b`
      // silently prevented, twice, while every run stayed green.
      expectAbsentWithLiveMatcher(
        INABILITY_TO_RESTART,
        {
          forbidden: 'This agent is unable to restart the MCP process itself.',
          allowed: 'this PROCESS must be restarted; reloading files will not do it.',
        },
        rw,
        `[${route.name}] what anyone can do about this process is host-dependent`,
      );
      // Reverse ordering too, since the verb can precede the modal.
      expectAbsentWithLiveMatcher(
        // ★ The liveness check caught this regex DEAD on its first run: `(not|im)?possible`
        // requires "notpossible" with no space, so it could never match "is not possible".
        // A brand-new dead matcher, found before it could pass vacuously even once.
        /\b(restart|respawn|relaunch)\w*\b[^.]{0,60}\b(is|are)\s+(not\s+|im)?possible\b/i,
        {
          forbidden: 'restarting this server is not possible from here.',
          allowed: 'this PROCESS must be restarted; reloading files will not do it.',
        },
        rw,
        `[${route.name}] no inability claim in either word order`,
      );
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

    // ⛔ THIS PINNED ONLY `.js`, AND THE OTHER FOUR ARMS WERE UNTESTED.
    //
    // graph-senior-dev-hermes removed `.json` from the production classifier and the file
    // stayed 8/8 GREEN; a package.json-only delta then produced the false reassurance
    // "BEHAVIOURALLY CURRENT" for a process whose executable config had changed.
    //
    // ⇒ The arms are DERIVED FROM THE PRODUCTION REGISTRY, not from a list copied into the
    // test — a copied list drifts from the thing it claims to describe, which is exactly
    // what had already happened to the prose (see EXECUTABLE_EXTENSIONS in server-build).
    // Adding an extension there without thinking cannot silently go untested.
    it('★★ the REGISTRY ITSELF is gated — shrinking it must not shrink the test set', () => {
      // ⛔ THE HOLE IN DERIVING ARMS FROM PRODUCTION, and I walked straight into it.
      //
      // The table below generates one case per registry member, which is right: a copied
      // list drifts from the thing it describes. But it means REMOVING a member removes
      // its own test. Replaying dev's exact mutant — deleting `.json` from the classifier
      // — produced 13 passing cases instead of 14 and NOT ONE FAILURE. The defect deleted
      // the evidence of itself.
      //
      // ⇒ So membership is pinned here, deliberately as a hand-written list. This is the
      // one place a copied list is correct: it is a RATCHET, not a description. Changing
      // what counts as executable is a decision that must be made consciously and stated
      // twice, because the reassurance "a restart is not required" is built on it.
      expect([...EXECUTABLE_EXTENSIONS].sort(), 'an extension may not silently leave the rule')
        .toEqual(['cjs', 'js', 'json', 'mjs', 'ts']);
    });

    it.each(EXECUTABLE_EXTENSIONS)('★★ a .%s in the delta withdraws the reassurance', (ext) => {
      diffFiles = ['docs/notes.md', `mcp/stdio/query/verbs/health.${ext}`];
      _resetServerBuildCache();
      const w = warning();

      expect(w, `a .${ext} in the delta means the running code may differ`)
        .not.toMatch(/BEHAVIOURALLY CURRENT/);
      expect(w).toMatch(/delta includes 1 executable file/);
    });

    // ⛔ THE CASE DIMENSION WAS UNPINNED. dev removed the `i` flag from the classifier and
    // every lower-case row stayed 15/15 GREEN — an uppercase `.JS` delta would then have
    // received the false reassurance. Production says case-insensitive, so both cases are
    // tested per registry member rather than assumed from the flag.
    it.each(EXECUTABLE_EXTENSIONS)('★★ a .%s in UPPER CASE also withdraws the reassurance', (ext) => {
      diffFiles = ['docs/notes.md', `mcp/stdio/query/verbs/health.${ext.toUpperCase()}`];
      _resetServerBuildCache();

      expect(warning(), `a .${ext.toUpperCase()} is the same executable file as .${ext}`)
        .not.toMatch(/BEHAVIOURALLY CURRENT/);
    });

    it('★ a NON-member extension does not withdraw it — the rule discriminates', () => {
      // Without this the tables above are satisfied by a classifier that calls everything
      // executable, which would make the reassurance unreachable rather than correct.
      diffFiles = ['docs/notes.md', 'assets/logo.png', 'notes.txt'];
      _resetServerBuildCache();

      expect(warning(), 'a .png is not executable code')
        .toMatch(/BEHAVIOURALLY CURRENT and a restart is not/);
    });

    it('★★ the extension must END the path — near-miss controls', () => {
      // dev removed the `$` anchor and the file stayed 15/15 green. Without it `.js.map`
      // (a sourcemap — data, not code) and `.js?query` classify as executable, and every
      // sourcemap-only delta would wrongly demand a restart. The reassurance is only
      // useful if it is also correct in the negative direction.
      diffFiles = ['docs/notes.md', 'dist/bundle.js.map', 'docs/guide.json.txt'];
      _resetServerBuildCache();

      expect(warning(), 'a sourcemap is not executable code')
        .toMatch(/BEHAVIOURALLY CURRENT and a restart is not/);
    });

    it('★★ the SENTENCE names exactly what the CLASSIFIER checks', () => {
      // The divergence this registry was introduced to end: the predicate tested .cjs
      // while the prose said ".js/.mjs/.ts/.json", so the sentence under-reported the rule
      // it described. A reader auditing a .cjs-only delta would have been told the process
      // was behaviourally current by a sentence that never mentioned the deciding
      // extension. Prose and predicate must be the same list or one of them is lying.
      diffFiles = ['docs/notes.md'];
      _resetServerBuildCache();
      const w = warning();

      for (const ext of EXECUTABLE_EXTENSIONS) {
        expect(w, `the reassurance must name .${ext}, which the classifier checks`)
          .toContain(`.${ext}`);
      }
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
