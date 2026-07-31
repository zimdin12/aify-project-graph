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
export const PINNED_INPUTS = [
  'repo_commit',       // the working tree the question was asked about
  'indexed_commit',    // what the graph actually indexed — may lag repo_commit
  'server_commit',     // changed both nextActions and consequences fields mid-engagement
  'compile_db_hash',   // foreign//stale compile DB silently changes C++ answers
  'overlay_age_days',  // the feature overlay is the most staleness-sensitive layer
  'index_ready',       // an unready clangd index answers differently, not not-at-all
];

// Bounded on purpose (property: "not unbounded"). A receipt that costs more to
// carry than the work costs to redo is decoration; the pins do the heavy lifting.
const MAX_CLAIMS = 40;

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
export function buildReceipt({ verb, args, pins = {}, claims = [], floor = {}, disconfirm = null }) {
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
    // Property 3: provenance per claim. The unit is the field, not the document.
    claims: trimmed,
    ...(claims.length > trimmed.length ? {
      claims_truncated: true,
      claims_note: `receipt capped at ${MAX_CLAIMS} claims — ${claims.length - trimmed.length} omitted; replay for the full set`,
    } : {}),
    // Property 4: the floor, stated.
    floor: {
      exhaustive: floor.exhaustive === true,
      cause: floor.cause ?? null,
      not_checked: floor.not_checked ?? [],
    },
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
    if (String(was) !== String(now)) drifted.push({ input: key, was, now });
  }

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
    ...(unverifiable.length > 0 ? {
      partial_warning:
        `Pins matched, but ${unverifiable.length} condition(s) could not be compared `
        + `(${unverifiable.join(', ')}). This is weaker than a full match: those inputs may have moved unseen.`,
    } : {}),
    detail: 'All comparable pinned inputs match. Claims are valid under current conditions — but a claim '
      + "marked `inferred` was never verified against code structure, and a matching pin does not upgrade it.",
  };
}

/** Collect the current pin values. Anything unavailable stays null — never guessed. */
export function currentPins({ repoCommit = null, manifest = null, compileDbHash = null, overlayAgeDays = null, indexReady = null } = {}) {
  let serverCommit = null;
  try { serverCommit = serverBuildInfo()?.commit ?? null; } catch { /* not fatal to the receipt */ }
  return {
    repo_commit: repoCommit,
    indexed_commit: manifest?.commit ?? null,
    server_commit: serverCommit,
    compile_db_hash: compileDbHash,
    overlay_age_days: overlayAgeDays,
    index_ready: indexReady,
  };
}
