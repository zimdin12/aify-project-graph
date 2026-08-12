// THE CLAIMS ARE THE CONTRACT. THE PROSE IS A RENDERING OF THEM.
//
// graph-senior-dev-hermes's answer to the question I could not solve: do not make prose
// authoritative. A paragraph cannot be policed by a blacklist (an open class), and it
// cannot be policed by an equality check either, because subject and expectation move
// together in one patch — which is exactly the survivor they demonstrated.
//
// ⇒ So the SEMANTIC CLAIMS become a closed typed set, and the sentence a reader sees is
// rendered from it. Adding a claim now means adding a claim ID: enumerable, legible in a
// diff, and testable as a sequence. A sentence appended inside a template literal is none
// of those.
//
// This warning has failed FOUR reviews, each to a phrasing the previous filter did not
// anticipate:
//   1. two exact phrasings banned      → a synonym passed
//   2. actors enumerated                → "THIS agent" passed
//   3. inability-modal + restart-verb   → "Only a human operator is permitted to restart
//                                          this service." passed (no inability modal)
//   4. approved-fragment equality       → editing production and the copy together passed
//
// ★★ THE HONEST LIMIT, stated because dev asked for it explicitly rather than left
// implicit: this repo has no governance boundary outside its own patch authority. A
// contributor who edits both this file and its test in one change still authorises
// themselves. What this design buys is CHANGE VISIBILITY — a new claim ID is legible in a
// diff in a way an extra sentence inside a template literal is not — and NOT independent
// semantic authorization. Calling it the latter would be the same overclaim the whole
// warning exists to prevent.
//
// Independent authorization would need a carrier outside this repo's ordinary patch
// authority: a review-gated CODEOWNERS contract, a signed policy artifact, or an external
// policy package pinned by digest. That is a real option and it is not implemented here.
//
// ⚠ THIS FILE WAS WRITTEN TWICE. The first version was destroyed by a bad restore and
// NEVER COMMITTED — while the commit message described it in detail. The three test
// failures I dismissed as "an undiagnosed flake" in that same commit were this breakage
// announcing itself. Recorded here because a lost file leaves no trace and a wrong commit
// message outlives the mistake.

// What the warning is ALLOWED to assert. Each ID is one claim, and the renderer may emit
// nothing that is not on this list.
export const CLAIM = Object.freeze({
  PROCESS_IS_STALE: 'process_is_stale',
  DELTA_NON_EXECUTABLE: 'delta_non_executable',
  DELTA_EXECUTABLE: 'delta_executable',
  DELTA_UNKNOWN: 'delta_unknown',
  PROCESS_RESTART_REQUIRED: 'process_restart_required',
  HOST_METHOD_UNKNOWN: 'host_method_unknown',
  SESSION_RESTART_MAY_NOT_RESPAWN: 'session_restart_may_not_respawn',
  VERIFY_BY_STARTED_AT: 'verify_by_started_at',
  COMMIT_NOT_RESTART_IDENTITY: 'commit_not_restart_identity',
});

// ⛔ CLAIM CLASSES THIS WARNING MAY NEVER MAKE, named so the prohibition is a property of
// the schema rather than of a regex someone has to keep widening.
//
// Both are assertions about the READER'S environment, which this server cannot observe.
// Every one of the four review failures above was an instance of one of them.
export const FORBIDDEN_CLAIM_CLASSES = Object.freeze([
  'host_actor_capability',   // "an agent cannot restart this" — what the reader is able to do
  'host_actor_permission',   // "only a human operator may restart this" — who is allowed to
]);

// The claim sequence per route. Order is part of the contract: the verification step must
// follow the instruction it verifies, or a reader acts before being told how to check.
export const ROUTE_CLAIMS = Object.freeze({
  docs_only: Object.freeze([
    CLAIM.PROCESS_IS_STALE, CLAIM.DELTA_NON_EXECUTABLE, CLAIM.PROCESS_RESTART_REQUIRED,
    CLAIM.HOST_METHOD_UNKNOWN, CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN,
    CLAIM.VERIFY_BY_STARTED_AT, CLAIM.COMMIT_NOT_RESTART_IDENTITY,
  ]),
  executable_delta: Object.freeze([
    CLAIM.PROCESS_IS_STALE, CLAIM.DELTA_EXECUTABLE, CLAIM.PROCESS_RESTART_REQUIRED,
    CLAIM.HOST_METHOD_UNKNOWN, CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN,
    CLAIM.VERIFY_BY_STARTED_AT, CLAIM.COMMIT_NOT_RESTART_IDENTITY,
  ]),
  delta_unknown: Object.freeze([
    CLAIM.PROCESS_IS_STALE, CLAIM.DELTA_UNKNOWN, CLAIM.PROCESS_RESTART_REQUIRED,
    CLAIM.HOST_METHOD_UNKNOWN, CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN,
    CLAIM.VERIFY_BY_STARTED_AT, CLAIM.COMMIT_NOT_RESTART_IDENTITY,
  ]),
});

// Which route a delta produces. Extracted so a test can assert the classification
// separately from the rendering — they are different claims and were previously fused.
export function routeForDelta(staleDelta) {
  if (!staleDelta) return 'delta_unknown';
  return staleDelta.behaviourally_current ? 'docs_only' : 'executable_delta';
}

// The rendered fragment for each claim. Dynamic authorities arrive as BOUND parameters
// rather than being interpolated at the call site, so a test can check the binding
// (`startedAt` is the real process identity) separately from the sentence.
export function renderClaim(id, bound = {}) {
  switch (id) {
    case CLAIM.PROCESS_RESTART_REQUIRED:
      return ' TO CLEAR IT: this PROCESS must be restarted; reloading files or re-running'
        + ' the tool will not do it.';
    case CLAIM.HOST_METHOD_UNKNOWN:
      // ⚠ States that the METHOD depends on the host — never who is able or permitted.
      // That distinction is the entire finding, and it is one claim now rather than a
      // sentence someone might extend.
      return ' How to restart depends on your host (an operator /mcp reconnect or CLI'
        + ' relaunch; in some deployments a peer agent can restart a managed session'
        + ' directly).';
    case CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN:
      return ' A session-level restart may cycle the agent worker WITHOUT respawning this'
        + ' MCP child, so verify with the timestamp below rather than assuming it worked.';
    case CLAIM.VERIFY_BY_STARTED_AT:
      return ` PROCESS STARTED: ${bound.startedAt} — if you just restarted and this`
        + ' timestamp is unchanged, the restart did not reach this process.';
    case CLAIM.COMMIT_NOT_RESTART_IDENTITY:
      return ' Check THIS, not the commit: an unsuccessful restart and a restart onto the'
        + ' same commit are indistinguishable by commit alone.';
    default:
      // Silence is the only safe default: a mistyped id must not put unreviewed prose in
      // front of a reader.
      return '';
  }
}
