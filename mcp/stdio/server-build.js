// SERVER BUILD IDENTITY — what code is actually answering you.
//
// Captured at MODULE LOAD, which is when this process read its code from disk.
// It used to be read lazily inside the first graph_health call, from the working
// DIRECTORY — which is a fact about the filesystem, not about the running build. A
// long-lived MCP server whose checkout moves underneath it (git pull, a push)
// reported the NEW commit while executing the OLD code.
//
// That cost a real verification window on 2026-07-30: sc-manager did the careful
// thing — restart, then confirm `server.commit` via graph_health BEFORE testing a
// fix — and the field answered about the filesystem. He then tested code that was
// never loaded. His words: it converted "I should check" into "I checked".
//
// `startedAt` shared the defect (it recorded first-call time, not process start),
// so the one field that could have caught the mismatch was broken the same way.
// A guard failing together with the thing it guards is how a blind spot survives.
//
// Extracted to its own module so EVERY surface can carry the warning, not just the
// diagnostic verb: if the process is stale, every answer it gives is suspect.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAIM, renderClaim } from './stale-warning-claims.js';

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function gitAt(root, args) {
  try {
    return execFileSync('git', ['-C', root, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch { return null; }
}

// Both captured at load: this is the process's own identity.
const PROCESS_STARTED_AT = new Date().toISOString();

// ⛔ AN OPEN PROSE CLASS CANNOT BE POLICED BY A LIST OF FORBIDDEN PHRASINGS.
//
// This guidance has now failed three reviews in a row, each time to a sentence the
// previous fix did not anticipate:
//   · two exact phrasings banned → a synonym walked through
//   · actors enumerated (you / your / the agent / an agent) → "THIS agent" walked through
//   · an inability-modal + restart-verb pairing → graph-senior-dev-hermes appended
//     "Only a human operator is permitted to restart this service." and it walked through
//     too. It is a false host-capability claim that contains no inability modal at all.
//
// ★ Each repair was a better blacklist, and a blacklist over natural language is never
// finished. There is no regex that proves a paragraph makes NO claim about the reader's
// environment; the class is open and negative evidence cannot close it.
//
// ⇒ SO THE PARAGRAPH BECOMES A CLOSED SET, NOT A FILTERED ONE. The restart guidance is
// this one approved fragment. A test asserts the emitted paragraph EQUALS it after the
// dynamic instant is substituted, so ANY added sentence — synonym, novel phrasing, or a
// claim nobody has thought of — changes the string and fails.
//
// ⚠ Yes, this is a wording contract, and this session has spent all day on the damage
// those do. The distinction that makes it correct here: a wording contract is dangerous
// when it pins prose carrying FACTUAL CLAIMS that can go stale — it then defends the stale
// claim against correction. This fragment is deliberately claim-FREE about the host, and
// the contract exists precisely to keep it that way. Changing it must be a conscious edit
// in two places, which is the point rather than the cost.
export const RESTART_GUIDANCE =
  ' TO CLEAR IT: this PROCESS must be restarted; reloading files or re-running the tool'
  + ' will not do it. How to restart depends on your host (an operator /mcp reconnect or'
  + ' CLI relaunch; in some deployments a peer agent can restart a managed session'
  + ' directly). A session-level restart may cycle the agent worker WITHOUT respawning'
  + ' this MCP child, so verify with the timestamp below rather than assuming it worked.';

// ★★ ONE REGISTRY, TWO CONSUMERS — because they had already diverged.
//
// The classifier tested /\.(js|mjs|cjs|ts|json)$/ while the sentence beneath it told the
// reader "no .js/.mjs/.ts/.json changed". `.cjs` was checked and NOT named: the prose
// under-reported the rule it was describing, so a reader auditing the claim against a
// .cjs-only delta would have been told the process was behaviourally current by a
// sentence that never mentioned the extension that decided it.
//
// Found while closing graph-senior-dev-hermes's finding that the test pinned only `.js` —
// removing `.json` from the classifier left 8/8 green. They were right about the gap and
// the gap was already occupied.
//
// ⇒ Both the predicate and the sentence now derive from this array, so they cannot drift.
// A test gates membership separately: adding an extension here without a case is caught.
export const EXECUTABLE_EXTENSIONS = ['js', 'mjs', 'cjs', 'ts', 'json'];
const EXECUTABLE_RE = new RegExp(`\\.(${EXECUTABLE_EXTENSIONS.join('|')})$`, 'i');
const EXECUTABLE_LIST = EXECUTABLE_EXTENSIONS.map((e) => `.${e}`).join('/');
// ⚠ THE SEAM IS ONE-DIRECTIONAL BY CONSTRUCTION, and that is the whole reason it is allowed to
// exist in production code. Overriding the LOADED commit can only make this process claim to be
// OLDER than it is — it manufactures staleness, it can never conceal it. A seam that could hide
// a real stale process would be a way to switch off the guard; this one is a way to switch it on.
// Needed because the wiring below has to be proven against a REAL spawned server, and a real
// server cannot be made stale without moving the checkout underneath it mid-test.
const LOADED_COMMIT = process.env.APG_TEST_FORCE_LOADED_COMMIT
  || gitAt(SERVER_ROOT, ['rev-parse', '--short', 'HEAD']);

// ★ CAPTURED AT LOAD, BESIDE THE COMMIT — NOT READ FROM DISK PER QUERY.
//
// ef-manager, 2026-08-11, on the v0.6.0 release itself: `version` was read from
// package.json at QUERY time, so it reported the CHECKOUT's version and never the
// running process's. Observed twice on one process — "0.5.0" before the release commit,
// "0.6.0" after, with `startedAt` IDENTICAL. The number moved without a restart.
//
// ⛔ Why this was the worst possible field to get wrong: `commit`, `staleProcess` and
// `staleWarning` are all honest, and `version` CONTRADICTED all three inside the same
// object — the one block whose entire job is telling a reader whether to trust the build.
// An agent asked to "verify the shipping build" reads `version`, sees the new number, and
// proceeds on a stale process.
//
// The old comment here said "version alone is not load-bearing". It became load-bearing
// the moment release notes were keyed to a version number, which is the same day this
// was found. A field's blast radius is not fixed at the time it is written.
// ★★ WAS THE TREE DIRTY WHEN THIS PROCESS LOADED? CAPTURED AT LOAD, LIKE THE COMMIT.
//
// Third instance of one defect in this file in one day, found by ef-manager each time:
// a QUERY-TIME field sitting inside the block whose job is BUILD IDENTITY, beside
// LOAD-TIME fields, with nothing marking which is which.
//
// The case that exposed it: their process started at 18:45 with HEAD=4615ed1 and
// UNCOMMITTED edits to this very file. Four minutes later those edits became 040b518. So
// the process runs code that exists in NO COMMIT — 4615ed1 plus part of 040b518 — and it
// reported:
//
//     commit: 4615ed1 · dirty: false · startedAt: 18:45:45Z
//
// `dirty` was true at load and read false afterwards, because the edits had since been
// committed. A reader parses that as "a clean build of 4615ed1". It is NEITHER.
//
// ⛔ THE FIELD FLIPPED TO A REASSURING VALUE WHILE THE PROCESS KEPT RUNNING THE DIRTY
// CODE. That is worse than a stale field: it is a field that heals itself while the
// condition it describes persists.
//
// ⇒ And it made the warning's own sentence false. "Answers come from 4615ed1" is untrue
// for a process that loaded 4615ed1 PLUS uncommitted changes — so the string whose job is
// to tell you which build you are on was misidentifying it.
//
// The query-time value is still reported, separately and named as such: the tree's
// CURRENT dirtiness is a real thing a reader may want. It just is not build identity.
const LOADED_DIRTY_FILES = (() => {
  const out = gitAt(SERVER_ROOT, ['status', '--porcelain', '--untracked-files=no']);
  if (out == null) return null;
  return out.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\S+\s+/, ''));
})();

const LOADED_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(SERVER_ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null; // installed copy without package.json
  }
})();

// ★ THE STALENESS VERDICT MUST NOT BE CACHED — IT IS THE ONE FIELD THAT CHANGES.
//
// This function used to cache its ENTIRE result on first call. Two of the values
// it returns are immutable by construction (the commit this process loaded, when
// it started), but `staleProcess` is a comparison against the tree RIGHT NOW, and
// the tree is the thing that moves.
//
// So the guard cached "I am not stale" and never looked again. Worse, the
// negative verdict omits the key entirely (see the spread below), so the frozen
// answer was indistinguishable from a build that had no check at all.
//
// Measured (sc-manager, 2026-08-07): their server loaded 709cacf on Aug 4, called
// a verb that day while the tree still matched, and cached staleProcess:false.
// Two commits landed on Aug 5. On Aug 7 graph_health returned NO staleProcess
// field — and they reasonably concluded the field post-dated their binary. It did
// not; it shipped Jul 30, five days before their process started. The check was
// present, correct, and answering a question it had stopped asking.
//
// The population this guard exists for is long-lived processes. A long-lived
// process is precisely the one that has had time to cache "fresh" before going
// stale, so the cache disabled the guard exactly where it was needed — the same
// shape as the defect it detects.
//
// Immutable parts stay cached. The comparison is recomputed, behind a short TTL
// so a multi-verb turn does not shell out to git on every call.
let _immutable = null;
let _verdict = null;
let _verdictAt = 0;
const VERDICT_TTL_MS = 5000;

export function serverBuildInfo() {
  const now = Date.now();
  if (_immutable && _verdict && (now - _verdictAt) < VERDICT_TTL_MS) {
    return { ..._immutable, ..._verdict };
  }
  const version = LOADED_VERSION;
  const dirtyOut = gitAt(SERVER_ROOT, ['status', '--porcelain', '--untracked-files=no']);
  // Read the tree NOW and compare. A difference means this process is stale: the
  // reported commit is what is RUNNING; the tree is what a restart would load.
  const treeCommit = gitAt(SERVER_ROOT, ['rev-parse', '--short', 'HEAD']);
  const staleProcess = Boolean(LOADED_COMMIT && treeCommit && LOADED_COMMIT !== treeCommit);
  // ★ COMMIT IDENTITY STOOD IN FOR BEHAVIOURAL DIFFERENCE.
  //
  // staleProcess says RESTART whether the delta is a guard that prevents data loss
  // or a single markdown file. ef-manager hit exactly that: loaded cad4569 vs tree
  // c526849, staleProcess true — and the entire delta was one doc. He had to run
  // `git diff --name-only` himself to learn the running server was behaviourally
  // current, which is the difference between "you must restart before collecting"
  // and "ignore this".
  //
  // Fail-closed remains right: unknown delta => assume it matters. But unknown had
  // a one-command path to known, which is the session's own lesson — a fail-closed
  // default is a prompt to go measure, not a resting state.
  let staleDelta = null;
  if (staleProcess) {
    const changed = gitAt(SERVER_ROOT, ['diff', '--name-only', `${LOADED_COMMIT}..${treeCommit}`]);
    if (changed != null) {
      const files = changed.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
      staleDelta = classifyStaleDelta({
        changedFiles: files,
        loadedDirtyCount: LOADED_DIRTY_FILES == null ? null : LOADED_DIRTY_FILES.length,
      });
    }
  }
  const loadedDirtyCount = LOADED_DIRTY_FILES == null ? null : LOADED_DIRTY_FILES.length;
  _immutable = {
    version,
    // ★ BUILD IDENTITY IS THE COMMIT *PLUS* WHATEVER WAS UNCOMMITTED AT LOAD.
    // `commit` alone names a build this process may never have run.
    commit: LOADED_COMMIT,
    // ★ ALWAYS PRESENT — OMIT-WHEN-HEALTHY IS RIGHT FOR DIAGNOSTICS AND WRONG FOR IDENTITY.
    //
    // This was wrapped in the dirty-only spread, so a clean load had NO `buildId` at all.
    // I had just told ef-manager "quote buildId, not commit" — they went to quote it and
    // it was absent, leaving only `commit`, which the comment two lines above calls
    // insufficient. An instruction that cannot be followed on the healthy path is worse
    // than no instruction.
    //
    // The asymmetry is the point: an empty `nextActions` MEANS something (nothing to do).
    // A missing identifier means nothing — it is just missing, and the reader falls back
    // to the field we are trying to replace. So there is exactly one name for the thing,
    // present in both states: `323641d` clean, `4615ed1+2dirty` when not.
    buildId: formatBuildId(LOADED_COMMIT, loadedDirtyCount),
    ...(loadedDirtyCount ? {
      loadedDirtyFiles: LOADED_DIRTY_FILES.slice(0, 20),
      loadedDirtyNote: `⚠ This process loaded ${loadedDirtyCount} UNCOMMITTED file(s), so it is running code that`
        + ` exists in no commit. Do NOT diff its behaviour or its output against ${LOADED_COMMIT} —`
        + ' that comparison is invalid in both directions. Restart from a clean tree before'
        + ' attributing anything to a commit.',
    } : {}),
    startedAt: PROCESS_STARTED_AT,
  };
  _verdictAt = now;
  _verdict = {
    // ⚠ QUERY-TIME, and named so it cannot be mistaken for build identity. This is the
    // tree's dirtiness NOW — it says nothing about what this process loaded, and it
    // silently healed to `false` once the edits a stale process was running got committed.
    // Build identity lives in `buildId` / `loadedDirtyFiles` above.
    treeDirtyNow: dirtyOut == null ? null : dirtyOut.length > 0,
    // Explicit false rather than an omitted key. An absent field cannot be told
    // apart from a build that never had the check — which is exactly the
    // inference sc-manager drew, correctly, from a missing key.
    staleProcess,
    ...(staleProcess ? {
      workingTreeCommit: treeCommit,
      ...(staleDelta ? { staleDelta } : {}),
      // ⛔ "THE CHECKOUT IS NOW X" READ AS REPO-SCOPED, AND THE DEFECT IS PROCESS-SCOPED.
      // ef-manager, 2026-08-19, catching themselves mid-inference: "I assumed I could at least
      // test on echoes, since echoes' checkout has not moved. It does not work that way: ONE MCP
      // process serves both repos, so a stale process poisons every repo it answers for. The
      // staleness field is scoped to the repo you ask about; the defect is scoped to the
      // process." They reasoned to the wrong conclusion for a minute before checking — and the
      // singular "the checkout" is the sentence that invited it.
      // ⚠ The stale bytes are the SERVER'S. Which repo you ask about does not change them.
      staleWarning: buildStaleWarning({ loadedCommit: LOADED_COMMIT, startedAt: PROCESS_STARTED_AT, treeCommit, staleDelta }),
    } : {}),
  };
  return { ..._immutable, ..._verdict };
}

// The one-line form for the shared read-verb warning channel. A stale process
// makes EVERY answer potentially wrong, so this does not belong only in
// graph_health — a reader who never calls health would never learn.
// ⛔ EXTRACTED SO IT CAN BE TESTED BY CALLING IT, NOT BY GREPPING IT. My first test for the
// process-scope fix asserted on the SOURCE TEXT of this module — the exact "gate on spelling
// rather than behaviour" defect graph-senior-dev has caught in two of my instruments this week,
// committed inside the fix for a scope defect. The suite-composition guard flagged it.
// ⇒ A pure function of its inputs. The test constructs a stale state and reads the sentence.
export function buildStaleWarning({ loadedCommit, startedAt, treeCommit, staleDelta }) {
  return `SERVER IS RUNNING STALE CODE: this process loaded ${loadedCommit} at ${startedAt},`
      + ` but the checkout is now ${treeCommit}. Answers come from ${loadedCommit}.`
      + ' ⚠ THIS APPLIES TO EVERY REPO THIS PROCESS SERVES, not only the one you asked about:'
      + ' the stale code belongs to the SERVER, so a second repo whose own checkout has not moved'
      + ' still gets answers from it.'
      + (staleDelta?.basis
        ? ' ⚠ AND THIS PROCESS LOADED UNCOMMITTED CHANGES, so it matches no commit and the delta'
          + ' below is a FLOOR: a commit-to-commit diff cannot see what it is actually running.'
          + ' RESTART from a clean tree before attributing behaviour to any commit.'
        : staleDelta?.behaviourally_current
        ? ` HOWEVER the delta is ${staleDelta.files_changed} non-executable file(s) only —`
          + ` no ${EXECUTABLE_LIST} changed, so this process is BEHAVIOURALLY CURRENT and a restart is not`
          + ' required for correctness.'
        : staleDelta
          ? ` The delta includes ${staleDelta.executable_files_changed} executable file(s)`
            + `${staleDelta.sample.length ? ` (e.g. ${staleDelta.sample.join(', ')})` : ''} —`
            + ' RESTART the aify-project-graph MCP server before trusting any behaviour attributed to the newer commit.'
          : ' Delta could not be computed, so assume it matters:'
            + ' RESTART the aify-project-graph MCP server before trusting any behaviour attributed to the newer commit.')
      // ⛔ THIS SENTENCE USED TO ASSERT A FALSE CAPABILITY CLAIM ABOUT THE HOST.
      //
      // It told the reader that an agent could not self-restart the server and to ask
      // the operator. False in this deployment: a peer agent can restart a managed
      // session through aify-comms, which respawns the worker and its MCP children.
      // ef-manager read it, believed it, and asked the operator twice for something
      // they could do in one call. It did not merely fail to help — it routed a capable
      // reader away from the action available to them. (2026-08-11)
      //
      // ★★ THE GENERAL FORM, worth more than the fix: PROSE CAN CARRY FACTUAL CLAIMS,
      // AND FACTS GO STALE. This string is pinned by stale-warning-actionable.test.js —
      // the ONE source-contract test judged legitimate of eighteen, because advisory
      // prose has no computation behind it. But a wording contract pins whatever
      // assertions the wording carries and DEFENDS THEM AGAINST CORRECTION: that test
      // would have gone red on this fix. Mutation cannot catch the class either — no
      // mutation of code makes a false sentence false-er. Only a reader acting on wrong
      // advice finds it, which is what happened.
      //
      // ⇒ So the fix is not better routing advice: it is to STOP ASSERTING A PROPERTY OF
      // THE HOST. Whether the reader can restart this process depends on who is hosting
      // it, and this server cannot know that. Only the invariant is stated — the PROCESS
      // must cycle, and the timestamp below is how you know it did.
      // ★★ RENDERED FROM THE CLAIM SCHEMA, not hand-assembled. Each fragment is one
      // enumerable claim ID in stale-warning-claims.js, so adding an assertion to this
      // warning means adding a claim — a visible act — rather than appending a sentence
      // inside a template literal where nothing enumerates it.
      //
      // ⚠ Buys CHANGE VISIBILITY, not independent authorization: a contributor editing
      // the schema and its test together still authorises themselves. Said plainly
      // because overclaiming here would be the defect the warning exists to prevent.
      + renderClaim(CLAIM.PROCESS_RESTART_REQUIRED)
      + renderClaim(CLAIM.HOST_METHOD_UNKNOWN)
      + renderClaim(CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN)
      // ★ AND GIVE THEM THE FIELD THAT ANSWERS "DID THE RESTART WORK".
      //
      // `commit` cannot answer it. After a failed restart it reads the same as
      // after a successful restart that happened to load the same code — so a
      // reader who checks `commit` retries the same action and re-reads the same
      // hash. Measured: ef-manager's startedAt held at 15:37:34.353Z across seven
      // hours, three commits and one restart attempt, which proved the process
      // had never cycled. That is the discriminator, and I had told them to check
      // the wrong field.
      // The dynamic authority is BOUND rather than interpolated here, so a test can
      // check that `startedAt` is the real process identity separately from checking
      // that the sentence says the right thing. Those are two claims and were one.
      + renderClaim(CLAIM.VERIFY_BY_STARTED_AT, { startedAt: PROCESS_STARTED_AT })
      + renderClaim(CLAIM.COMMIT_NOT_RESTART_IDENTITY);
}

/**
 * ⛔ A BARE buildId MEANT "CLEAN" *OR* "COULD NOT TELL", AND THEY READ IDENTICALLY.
 *
 * `loadedDirtyCount` is `null` when `git status` failed and `0` when the tree was genuinely
 * clean. Both are falsy, so both produced the bare commit — and the reassuring one is the reading
 * everybody takes. A reader quoting `e18a739` as the build under test cannot know whether that
 * identity was verified or merely unavailable.
 *
 * Found while checking a DIFFERENT claim: ef-manager proposed that buildId should carry the dirt,
 * which it already did. Reading the code to confirm that showed the null branch collapsing into
 * the clean branch one line below. The suggestion was already implemented; the defect beside it
 * was not.
 *
 * ⇒ Three states, three strings. `abc1234` is verified clean, `abc1234+2dirty` is known dirty,
 * `abc1234+dirt-unknown` is the state that used to impersonate clean.
 */
/**
 * ⛔ `behaviourally_current` COULD GRANT TRUE OVER A LOAD THAT MATCHES NO COMMIT.
 *
 * It was computed purely commit-to-commit — `git diff LOADED_COMMIT..treeCommit` — and never
 * consulted what this process actually loaded. ef-manager walked the reachable path, which is the
 * loop I have been running all night:
 *
 *   1. process loads at X with an uncommitted experimental edit  -> buildId `X+1dirty` (honest)
 *   2. the experiment is judged wrong and DISCARDED               -> git checkout -- <file>
 *   3. an unrelated docs-only change is committed as Y
 *   4. diff X..Y contains zero executables                        -> behaviourally_current TRUE
 *
 * The process is then running an experimental file that exists in no commit and was deliberately
 * thrown away, while the field an agent consults to decide whether to restart says it is current.
 * Same shape as the bare-buildId defect one field over: the state that cannot be distinguished is
 * the reassuring one, and the reassuring reading is the one everybody takes.
 *
 * ⇒ A DIRTY LOAD IS NOT ANY COMMIT, so no commit-to-commit diff can certify it. `null` rather
 * than `false`: it is not "we checked and it differs", it is "this question has no answer for
 * this process". Null is also falsy, so a consumer treating it as a boolean fails CLOSED.
 *
 * ⚠ And `files_changed` becomes a FLOOR under a dirty load — the diff cannot see the uncommitted
 * files — so it carries the same kind of disclosure this codebase already puts on `truncated`
 * and `terminated`.
 */
export function classifyStaleDelta({ changedFiles = [], loadedDirtyCount }) {
  const executable = changedFiles.filter((f) => EXECUTABLE_RE.test(f));
  const dirtyLoad = loadedDirtyCount == null || loadedDirtyCount > 0;
  return {
    files_changed: changedFiles.length,
    executable_files_changed: executable.length,
    behaviourally_current: dirtyLoad ? null : executable.length === 0,
    sample: executable.slice(0, 5),
    ...(dirtyLoad ? {
      basis: 'FLOOR — this process loaded uncommitted changes (or their state could not be'
        + ' determined), so it corresponds to no commit and a commit-to-commit diff cannot'
        + ' describe what it is running. Restart from a clean tree before attributing behaviour'
        + ' to any commit.',
    } : {}),
  };
}

export function formatBuildId(commit, dirtyCount) {
  if (dirtyCount == null) return `${commit}+dirt-unknown`;
  return dirtyCount > 0 ? `${commit}+${dirtyCount}dirty` : `${commit}`;
}

export function staleProcessWarning() {
  const b = serverBuildInfo();
  return b.staleProcess ? b.staleWarning : null;
}

// Test seam: force the next call to re-derive instead of waiting out the TTL.
export function _resetServerBuildCache() { _verdict = null; _verdictAt = 0; }
