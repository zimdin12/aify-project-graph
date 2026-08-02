// ★ A RECEIPT IS NOT EVIDENCE FOR A CLAIM. IT IS THE CLAIM PLUS ITS
//   INVALIDATION CONDITIONS.
//
// Design owed entirely to ef-manager (2026-07-31), who named the gap after two
// measured experiments: there is no way to hand another agent a claim TOGETHER
// with its evidence. Everything is per-session and per-call; a teammate gets your
// prose, not a receipt they can re-verify. So they re-derive, or — worse — they
// don't, and one agent's unaudited answer becomes three agents' shared premise.
//
// The framing that makes it buildable is his: the valuable part is not "here is
// why I believed it", it is "here is exactly when this stops being true". Prose
// carries the first and can never carry the second.
//
// The argument for building it is that he and I ran the failure ourselves, in the
// conversation where we designed it. He sent a three-edge include chain as a
// verified finding. It was wrong — he used `#include` as the pattern for hop 1
// and a BARE FILENAME grep for hop 2, and a bare filename cannot distinguish an
// include EDGE from a comment MENTION. I only caught it by opening two files by
// hand, and only because I happen to know the edge table. With a replayable
// receipt it would have surfaced in one call, read by neither of us.
//
// SIX PROPERTIES, each earned by a specific observed failure:
//
//   1. RE-EXECUTABLE, NOT READABLE — the core is {verb, args}. B replays the
//      call rather than reading the reasoning. If the answer differs, THE
//      DIFFERENCE IS THE FINDING, which is worth more than the original claim.
//   2. PIN EVERY INPUT THAT CAN CHANGE THE ANSWER — repo commit is NOT enough.
//      The same repo commit produced different answers across server commit,
//      compile-DB hash, index readiness, and overlay age. A receipt pinning only
//      the git SHA would have validated every one of those wrong answers.
//   3. PROVENANCE PER CLAIM, NOT PER RECEIPT — one response held the best answer
//      of the engagement and a wrong one, from the same mechanism. A single
//      top-level confidence re-commits the tests_adjacent bug at document scale.
//   4. STATE THE FLOOR EXPLICITLY — what was not checked, and why. A receipt that
//      omits its floor is worse than no receipt: it launders a floor into a fact.
//   5. NAME THE CHEAPEST DISCONFIRMING TEST — not "trust this" but "if this is
//      wrong, THIS ONE CALL shows it". If checking costs what redoing costs,
//      nobody checks, and the receipt is decoration.
//   6. STALENESS TRAVELS WITH THE CLAIM — on the field, not in a header.
//
// ★ AND THE PROPERTY THAT SEPARATES A RECEIPT FROM A CACHE: on replay, if any
//   pinned input differs, REFUSE TO VALIDATE rather than return the old answer.
//   A receipt that silently serves a stale result is a cache, and a cache is
//   exactly the mechanism by which one agent's stale answer becomes shared truth.
//   Fail loud.

import { createHash } from 'node:crypto';
import { serverBuildInfo } from '../server-build.js';

export const RECEIPT_VERSION = 1;

// ★ SELF-CONTAINED AND CONTENT-ADDRESSED, which is what makes the transport
//   question stop mattering — ef-manager's correction to my (a)/(b)/(c) trichotomy.
//
// I was about to pick "write to .aify-graph/receipts/ with a stable id". He killed
// it with a fact I should have seen: WE DO NOT SHARE A REPO. He works in
// echoes_of_the_fallen, I work in aify-project-graph, and a receipt written to
// echoes' .aify-graph/ is invisible to me. Every exchange across this engagement
// would have been unserved by it. It generalizes too — this project has a standing
// rule that tester and coder use SEPARATE worktrees, because a shared one destroyed
// uncommitted patches. Cross-filesystem is the NORMAL case for teams, not the
// exception, so any design assuming a shared path is fragile exactly where teams
// need it most.
//
// With a content-derived id, all three transports work and the choice demotes from
// an architecture commitment to an operational detail:
//   paste the body                     — zero infrastructure, works today
//   .aify-graph/receipts/<id>.json     — a local CACHE of bodies; dedup and
//                                        integrity-checking fall out for free
//   comms carries the HEAD             — body only if the recipient can't resolve it
//
// The id must therefore never point into local state.

/** Stable stringify: sorted keys, so the same claim set always hashes the same. */
function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function receiptId(body) {
  return `rcpt_${createHash('sha256').update(canonicalJson(body)).digest('hex').slice(0, 16)}`;
}

// Pins are the invalidation conditions. Every one of these was observed changing
// an answer while the repo commit stayed identical — that is the bar for being on
// this list, not a guess about what might matter.
// ★ EVERY PIN MUST BE AN IDENTITY, NOT A MEASUREMENT.
//
// ef-manager's category-error catch, against his own earlier suggestion: five of
// the original six pins were content-derived identities, and `overlay_age_days`
// was a CLOCK READING — now minus mtime. That breaks pin semantics in three
// directions at once:
//
//   · FALSE DRIFT daily: issued at 96, replayed tomorrow computes 97. Nothing
//     changed. Every receipt would report drift after 24h for a reason unrelated
//     to correctness — and the first response to that is to relax the comparison,
//     which is how a pin dies.
//   · FALSE DRIFT inverted: regenerate the overlay with byte-identical content,
//     age drops to 0, drift reported where none exists.
//   · ★ FALSE MATCH, the dangerous one: overlay rewritten with DIFFERENT content,
//     replayed at a moment when the computed age happens to equal the stored
//     number. Pins match, claims are stale, nothing says so.
//
// So the overlay is pinned by CONTENT HASH, and its age is still reported — as a
// non-pin. They answer different questions and only one is an invalidation
// condition. The age still drives the 30-day warning; it just cannot validate.
export const PINNED_INPUTS = [
  'repo_commit',          // the working tree the question was asked about
  'indexed_commit',       // what the graph actually indexed — may lag repo_commit
  'server_commit',        // changed both nextActions and consequences fields mid-engagement
  'compile_db_hash',      // foreign/stale compile DB silently changes C++ answers
  'overlay_content_hash', // identity of the curated overlay — NOT its age
  'worktree_dirty_hash',  // uncommitted edits: commit matches, tree does not
  'index_ready',          // an unready index answers differently, not not-at-all
];

// Reported with the receipt but NEVER used to validate. Measurements that inform
// a reader and cannot serve as invalidation conditions.
export const REPORTED_CONTEXT = ['overlay_age_days'];

// Bounded on purpose (property: "not unbounded"). A receipt that costs more to
// carry than the work costs to redo is decoration; the pins do the heavy lifting.
const MAX_CLAIMS = 40;

/**
 * ★ UNKNOWN IS NOT UNTRUNCATED — the structural fix for the bug generator.
 *
 * ef-manager's, and he built it out of a sentence I had written four messages
 * earlier about a different field ("'clean' and null are distinct — unknown is not
 * clean"), then applied it where it actually pays.
 *
 * His diagnosis of WHY this defect kept recurring is the important part, and it is
 * not "flags get dropped" — flags get dropped in every codebase. It is that
 * `exhaustive` was computed by AND-ing conditions, so a MISSING truncation flag
 * evaluated falsy, which read as "not truncated", which is PERMISSIVE. The default
 * direction of the failure was toward claiming completeness. That is a bug
 * GENERATOR: it produces new instances faster than they can be fixed one at a
 * time, which is exactly the rate we observed — four in one day.
 *
 * So exhaustiveness inputs must be PROVEN non-truncated. A field whose truncation
 * state is absent or undefined forces exhaustive:false with a cause naming it.
 * Dropping a flag now produces a CONSERVATIVE receipt instead of a false one, and
 * it retroactively covers paths nobody has audited.
 *
 * @param {Array<[string, any]>} namedLists - [fieldName, list] pairs feeding the claim
 * @returns {{ proven: boolean, unknown: string[], truncated: string[] }}
 */
export function assessTruncation(namedLists = []) {
  const unknown = [];
  const truncated = [];
  for (const [name, list] of namedLists) {
    if (list == null) continue; // absent field claims nothing
    if (Array.isArray(list)) {
      // A bare array cannot prove it was not cut. This is the shape that caused
      // every instance — including co_consumer_files, which won an experiment
      // while silently stopping at 10.
      unknown.push(name);
      continue;
    }
    if (typeof list.truncated !== 'boolean') { unknown.push(name); continue; }
    if (list.truncated) truncated.push(name);
  }
  return { proven: unknown.length === 0 && truncated.length === 0, unknown, truncated };
}

/**
 * Build a portable receipt for a claim set.
 *
 * @param {object} o
 * @param {string} o.verb            - the verb to replay, e.g. 'graph_consequences'
 * @param {object} o.args            - exact args to replay with
 * @param {object} o.pins            - values for PINNED_INPUTS (missing → null, never guessed)
 * @param {Array}  o.claims          - [{ field, value, provenance, basis, source_age_days? }]
 * @param {object} o.floor           - { exhaustive: boolean, cause: string|null, not_checked: string[] }
 * @param {object} o.disconfirm      - { verb, args, expect } — the cheapest test that would refute this
 */
export function buildReceipt({ verb, args, pins = {}, claims = [], floor = {}, disconfirm = null, reported_context = null }) {
  const pinned = {};
  for (const key of PINNED_INPUTS) {
    // A missing pin is recorded as null and reported, never quietly omitted:
    // an absent pin is an unverifiable receipt, and the reader must be able to
    // see which condition was not captured.
    pinned[key] = Object.hasOwn(pins, key) && pins[key] !== undefined ? pins[key] : null;
  }
  const missingPins = PINNED_INPUTS.filter((k) => pinned[k] === null);

  const trimmed = claims.slice(0, MAX_CLAIMS);
  const body = {
    receipt_version: RECEIPT_VERSION,
    replay: { verb, args },
    pinned_inputs: pinned,
    ...(missingPins.length > 0 ? {
      unpinned_inputs: missingPins,
      unpinned_warning:
        `${missingPins.length} invalidation condition(s) could not be captured: ${missingPins.join(', ')}. `
        + 'Replay CANNOT prove those unchanged, so a matching replay is weaker evidence than it looks.',
    } : {}),
    // Measurements that inform but CANNOT validate. Kept structurally separate
    // from pinned_inputs so nothing can quietly start comparing them: an age is a
    // clock reading, and comparing clock readings produces daily false drift and
    // the occasional silent false match.
    ...(reported_context ? { reported_context } : {}),
    // Property 3: provenance per claim. The unit is the field, not the document.
    claims: trimmed,
    ...(claims.length > trimmed.length ? {
      claims_truncated: true,
      claims_note: `receipt capped at ${MAX_CLAIMS} claims — ${claims.length - trimmed.length} omitted; replay for the full set`,
    } : {}),
    // Property 4: the floor, stated — and NOT taken on the caller's word.
    //
    // The door half of the fix: a caller may pass `sources` (named lists feeding
    // the claim), and exhaustive:true survives only if every one PROVES it was not
    // truncated. Combined with the flipped default this closes both directions —
    // the door stops a bare array entering, the default stops it mattering if it
    // slips past somewhere unaudited.
    floor: (() => {
      const declared = floor.exhaustive === true;
      const t = assessTruncation(floor.sources ?? []);
      if (declared && !t.proven) {
        const why = [
          t.unknown.length ? `truncation state unknown for ${t.unknown.join(', ')}` : null,
          t.truncated.length ? `${t.truncated.join(', ')} was truncated` : null,
        ].filter(Boolean).join('; ');
        return {
          exhaustive: false,
          cause: `${floor.cause ? `${floor.cause}; ` : ''}exhaustive claim REFUSED — ${why}. An unproven list cannot support a completeness claim.`,
          not_checked: floor.not_checked ?? [],
          downgraded_from_declared_exhaustive: true,
        };
      }
      return {
        exhaustive: declared,
        cause: floor.cause ?? null,
        not_checked: floor.not_checked ?? [],
      };
    })(),
    // Property 5: the cheapest thing that would prove this wrong.
    disconfirming_test: disconfirm,
    how_to_use:
      'Do NOT read this as a citation. Replay `replay.verb` with `replay.args` and compare. '
      + 'If any pinned_input differs, this receipt is INVALID — do not fall back to the values here, '
      + 'they are a cache at that point. If the pins match but a claim differs, THE DIFFERENCE IS THE '
      + 'FINDING and is worth more than the original claim.',
  };
  return { id: receiptId(body), ...body };
}

/**
 * ★ SPLIT HEAD FROM BODY — validation and reading are different jobs.
 *
 * ef-manager's refinement, and the property is one I would not give up: A TEAMMATE
 * CAN DETECT DRIFT WITHOUT TRANSFERRING THE BODY. Validation needs only the pins;
 * reading needs the claims. You validate every time and read rarely, so a single
 * blob makes the cheap always-run operation pay the cost of the expensive
 * rarely-run one — and 27 claims is already past comfortable pasting, before
 * generalizing to more verbs.
 *
 * It also degrades in the right direction: a teammate holding only the head whose
 * pins have DRIFTED already knows not to trust the claims, and never needs to
 * fetch them. The stale case is exactly the case where shipping the body is pure
 * waste, and the head alone fully resolves it.
 */
/**
 * ★ HEAD BY DEFAULT. The body is opt-in.
 *
 * Measured 2026-08-02: the full receipt was 51% of a graph_consequences response
 * (5913 of 11506 bytes) and 37% of graph_pull. The head is 1245 bytes — a ~40%
 * cut to the flagship verb's total size.
 *
 * This is not only a token saving, it is the design the split was built for and
 * then not wired to: validation needs pins, reading needs claims, and you validate
 * every time and read rarely. The head carries {verb, args} so a teammate REPLAYS
 * rather than fetching a body — replay is the primitive, the body is a convenience
 * for comparing claim-by-claim without re-running.
 *
 * Pass mode='full' when you actually need the per-claim provenance.
 */
export function receiptFor(receipt, mode) {
  if (!receipt) return null;
  return mode === 'full' ? receipt : receiptHead(receipt);
}

export function receiptHead(receipt) {
  if (!receipt) return null;
  return {
    id: receipt.id,
    receipt_version: receipt.receipt_version,
    replay: receipt.replay,
    pinned_inputs: receipt.pinned_inputs,
    ...(receipt.unpinned_inputs ? { unpinned_inputs: receipt.unpinned_inputs } : {}),
    claim_count: receipt.claims?.length ?? 0,
    exhaustive: receipt.floor?.exhaustive === true,
    disconfirming_test: receipt.disconfirming_test,
    body_note:
      'HEAD only. Sufficient to validate — pin drift is detectable from this alone, and if the pins '
      + 'drifted the claims are moot, so the body is never worth fetching in that case. Fetch the body '
      + `by id (${receipt.id}) only when the pins match AND you need the per-claim provenance.`,
  };
}

/**
 * ★ THE ONLY DOOR TO A BODY. Read claims through this or not at all.
 *
 * ef-manager flagged the seam he had opened himself when proposing the split, and
 * he was right that the two properties do not compose for free: the content
 * address closes body tampering ONLY IF the body is checked against head.id, but
 * validateReceipt deliberately works on the HEAD ALONE so drift is detectable
 * without transferring the body. That leaves a path where a validated head is
 * followed by a body nobody ever hashed — and then the content address is present
 * and doing nothing, which is WORSE than absent because it is reassuring.
 *
 * His fix shape, taken verbatim: not a separate verify function an agent must
 * remember to call, because the ones you must remember are the ones that get
 * skipped. Reading a body is impossible except through a call that takes the head
 * and recomputes the hash.
 *
 * Returns the claims only when the body hashes to the head's id AND the pins in
 * the two halves agree — a head paired with a body from a different receipt is the
 * swap this is here to stop.
 */
export function openReceiptBody(head, body) {
  if (!head?.id) return { ok: false, reason: 'no_head_id', detail: 'cannot open a body without a head to check it against — that is the whole point of the split' };
  const integrity = verifyReceiptIntegrity(body);
  if (!integrity.intact) {
    return {
      ok: false,
      reason: 'body_integrity_failed',
      detail: `body does not hash to its own id (${integrity.reason}). Do not read these claims.`,
    };
  }
  if (body.id !== head.id) {
    return {
      ok: false,
      reason: 'head_body_mismatch',
      detail: `this body (${body.id}) is not the one this head (${head.id}) names — a valid head paired with the wrong body reads as verified, so it is refused.`,
    };
  }
  return { ok: true, claims: body.claims, floor: body.floor };
}

/** Verify a body actually is the one the id names. Integrity falls out of content addressing. */
export function verifyReceiptIntegrity(receipt) {
  if (!receipt?.id) return { intact: false, reason: 'no_id' };
  const { id, ...body } = receipt;
  const recomputed = receiptId(body);
  return recomputed === id
    ? { intact: true }
    : { intact: false, reason: 'id_mismatch', expected: id, recomputed, detail: 'receipt body does not hash to its id — it was altered in transit or hand-edited' };
}

/**
 * Validate a receipt against the current world.
 *
 * Refuses on ANY pin mismatch. This is the cache/receipt boundary: returning the
 * old answer when an input moved is precisely how a stale answer becomes shared
 * truth across a team.
 */
export function validateReceipt(receipt, currentPins = {}) {
  if (!receipt || receipt.receipt_version !== RECEIPT_VERSION) {
    return {
      valid: false,
      reason: 'unreadable_receipt',
      detail: `receipt_version ${receipt?.receipt_version ?? '(absent)'} is not ${RECEIPT_VERSION} — cannot interpret its pins, so it cannot be validated`,
    };
  }

  const drifted = [];
  const unverifiable = [];
  for (const key of PINNED_INPUTS) {
    const was = receipt.pinned_inputs?.[key] ?? null;
    const now = Object.hasOwn(currentPins, key) && currentPins[key] !== undefined ? currentPins[key] : null;
    // Never captured then, or not observable now: this pin proves nothing either
    // way, and saying so is the honest result. Silence here would let a receipt
    // with five null pins report a clean match.
    if (was === null || now === null) { unverifiable.push(key); continue; }
    // ★ TYPE-STRICT. `String(was) !== String(now)` let 96 and "96" compare EQUAL —
    // a type-confused FALSE MATCH, and exactly the kind that survives a JSON
    // round-trip through a transport. A pin whose type changed is a pin whose
    // provenance changed; treat it as drift and say which.
    if (typeof was !== typeof now) {
      drifted.push({ input: key, was, now, note: `type changed (${typeof was} → ${typeof now}) — a value that round-tripped through a different representation is not proof of an unchanged input` });
      continue;
    }
    if (was !== now) drifted.push({ input: key, was, now });
  }
  const compared = PINNED_INPUTS.length - unverifiable.length;

  if (drifted.length > 0) {
    return {
      valid: false,
      reason: 'pinned_input_drift',
      drifted,
      unverifiable,
      detail:
        `${drifted.length} pinned input(s) changed since this claim was made: `
        + `${drifted.map((d) => `${d.input} ${d.was} → ${d.now}`).join('; ')}. `
        + 'The claims in this receipt are NOT valid under current conditions. Replay the call; '
        + 'do not read the stored values, which are a cache at this point.',
    };
  }

  if (unverifiable.length === PINNED_INPUTS.length) {
    return {
      valid: false,
      reason: 'nothing_pinned',
      unverifiable,
      detail: 'No pinned input could be compared. A receipt that pins nothing validates nothing — replay the call.',
    };
  }

  return {
    valid: true,
    unverifiable,
    // ★ SAY HOW MUCH EVIDENCE THIS VERDICT RESTS ON, in the verdict itself.
    //
    // Refusing only when ALL pins are null meant 5 nulls plus 1 match reported
    // valid:true on one-sixth of the evidence, and a caller had to read the pin
    // block to discover that. That is my own unpinned_inputs principle applied one
    // level in, and ef-manager was right to turn it back on me: a VALIDATION that
    // looks complete converts a known gap into an invisible one, exactly as an
    // unpinned input that looks pinned does.
    pins_compared: `${compared}/${PINNED_INPUTS.length}`,
    ...(unverifiable.length > 0 ? {
      partial_warning:
        `VALID ON ${compared} OF ${PINNED_INPUTS.length} PINS. ${unverifiable.length} condition(s) could not be compared `
        + `(${unverifiable.join(', ')}). This is weaker than a full match: those inputs may have moved unseen`
        + (compared <= 2 ? ' — and at this few comparisons the verdict is close to meaningless.' : '.'),
    } : {}),
    detail: 'All comparable pinned inputs match. Claims are valid under current conditions — but a claim '
      + "marked `inferred` was never verified against code structure, and a matching pin does not upgrade it.",
  };
}

/** Collect the current pin values. Anything unavailable stays null — never guessed. */
export function currentPins({
  repoCommit = null, manifest = null, compileDbHash = null,
  overlayContentHash = null, worktreeDirtyHash = null, indexReady = null,
} = {}) {
  let serverCommit = null;
  try { serverCommit = serverBuildInfo()?.commit ?? null; } catch { /* not fatal to the receipt */ }
  return {
    repo_commit: repoCommit,
    indexed_commit: manifest?.commit ?? null,
    server_commit: serverCommit,
    compile_db_hash: compileDbHash,
    overlay_content_hash: overlayContentHash,
    worktree_dirty_hash: worktreeDirtyHash,
    index_ready: indexReady,
  };
}

/** Content identity of the curated overlay. Null when absent — never a placeholder. */
export function hashOverlayContent(readFileSyncFn, paths = []) {
  const h = createHash('sha256');
  let any = false;
  for (const p of paths) {
    try { h.update(readFileSyncFn(p)); any = true; } catch { /* absent file contributes nothing */ }
  }
  return any ? h.digest('hex').slice(0, 16) : null;
}

/**
 * Identity of the uncommitted state. ef-manager's A3, and the common case is
 * commoner than the one I had named: repo_commit matches, indexed_commit matches,
 * and someone has forty uncommitted modifications open in an editor. No rebuild
 * required. graph_health already reports trackedDirtyFiles — the signal existed
 * and simply was not a pin.
 *
 * TRACKED files only: untracked noise (this repo carries thousands of untracked
 * snapshot files) would make the pin drift constantly for reasons that cannot
 * change an answer.
 */
export function hashWorktreeDirty(trackedDirtyPaths = null) {
  if (trackedDirtyPaths == null) return null; // unknown ≠ clean
  if (trackedDirtyPaths.length === 0) return 'clean';
  return createHash('sha256').update([...trackedDirtyPaths].sort().join('\n')).digest('hex').slice(0, 16);
}
