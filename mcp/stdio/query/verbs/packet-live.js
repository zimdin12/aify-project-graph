// PACKET LIVE ENRICHMENT — the one path that leaves the static snapshot.
//
// Phase 0 slice 3, MECHANICAL: the three bodies below are byte-identical to the ones that were in
// packet.js, comment blocks included.
//
// the reviewer's ruling for this slice: "Move withTimeout + enrichLive into packet-live.js;
// inject/import graphConsequences there without importing packet.js. Pin timeout/error/enriched
// output and timer cleanup."
//
// ⚠ THE CONSEQUENCES IMPORT STAYS LAZY, exactly as it was. The comment on it — "so static-only
// callers never pay the import cost" — is the reason graph_packet's static path is
// sub-millisecond, and making it static here would move that cost onto every packet call
// including the ones that never enrich. It also keeps this island off the facade: consequences.js
// does not import packet.js, so there is no cycle in either direction.
//
// ⛔ AND THE GUARD CANNOT COVER `enrichLive`. Every corpus cell calls graphPacket without
// `live: true`, and that flag defaults false — so the byte-comparison corpus cannot reach this
// function at all. Adding a live route would put `LIVE: enriched (147ms)` into the corpus, and a
// timing is volatile; dev was explicit that elapsed_ms must not be scrubbed generically, because
// "a regex scrub is another way to erase a real drift".
//
// ⇒ So enrichLive is covered by unit tests that mutate it, and the guard coverage for this slice
// is reported as what it is — 2 of 3 by the guard, the third by its own tests — rather than
// rolled into one number that would imply the corpus reaches something it cannot.
// ⛔ A HARD-WIRED BUDGET MADE THE SUITE'S GREEN/RED VERDICT DEPEND ON MACHINE LOAD.
//
// This bounds a symbol→feature lookup whose own measured cost is 601ms on a 3958-node repo and
// 4316ms on a 12126-node one (see packet.js). On a busy machine the lookup crosses 2000ms, packet
// takes its timeout branch, and any test asserting on the CONTENT fails. Measured today: the full
// suite ran 680s / 2120s / 2693s on the same tree, with 0 / 2 / 10 failures — failures scaling with
// duration, every one of them budget-shaped.
//
// That is worse than a slow test. "Full suite green before push" is the gate this project relies on,
// and a load-dependent verdict makes a real regression indistinguishable from contention: three
// separate investigations today ended in "it was load", which is exactly the signal-destroying
// outcome the gate exists to prevent.
//
// ⚠ The DEFAULT IS UNCHANGED, so product behaviour is identical. Only the environment may raise it,
// because a value that varies by environment belongs in configuration rather than in a constant.
// A non-numeric or non-positive value falls back to the default rather than disabling the budget —
// an unbounded lookup is the defect this budget exists to prevent, and a typo must not create one.
export const DEFAULT_LIVE_BUDGET_MS = 2000;

/**
 * Resolve the budget from a raw environment value. PURE — inputs in, value out — so it is testable
 * without module-cache tricks; a first attempt re-imported the module with a cache-busting query
 * string, which the bundler rejects outright.
 */
export function resolveLiveBudget(raw, fallback = DEFAULT_LIVE_BUDGET_MS) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const LIVE_BUDGET_MS = resolveLiveBudget(process.env.APG_LIVE_BUDGET_MS);

export async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });
  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

export async function enrichLive({ repoRoot, target, kind, value, opts }) {
  // Lazy import so static-only callers never pay the import cost.
  const { graphConsequences } = await import('./consequences.js');
  const t0 = Date.now();

  // graph_consequences accepts symbol OR file path; for feature/task targets
  // we synthesize a representative file path from anchors when possible.
  // If we can't, skip enrichment with an explicit reason.
  let consequenceTarget = target;
  if (kind === 'feature' || kind === 'task') {
    // No bare-symbol path available without going through overlay anchors;
    // use the original target string and let consequences resolve it (works
    // for tasks because consequences has task lookup; works for features
    // when bare id matches a feature).
    consequenceTarget = value;
  }

  let raw;
  try {
    raw = await withTimeout(
      graphConsequences({ repoRoot, target: consequenceTarget }),
      LIVE_BUDGET_MS,
    );
  } catch (err) {
    return { status: 'unavailable', detail: err?.message ?? 'live verb threw', elapsed_ms: Date.now() - t0 };
  }
  if (raw && raw.__timeout) {
    return { status: 'timeout', detail: `live enrichment exceeded ${LIVE_BUDGET_MS}ms`, elapsed_ms: Date.now() - t0 };
  }

  let parsed = null;
  try {
    if (typeof raw === 'object' && raw !== null) parsed = raw;
    else if (typeof raw === 'string') parsed = JSON.parse(raw);
  } catch {
    // graph_consequences returns plain markdown for NO MATCH and other
    // user-friendly messages — not a real error. Treat as "no enrichment
    // available for this target" rather than a verb failure.
    if (typeof raw === 'string' && /^NO MATCH|^ERROR|^GRAPH/i.test(raw.trim())) {
      return { status: 'unavailable', detail: 'no live data for this target', elapsed_ms: Date.now() - t0 };
    }
    return { status: 'unavailable', detail: 'live verb returned non-JSON', elapsed_ms: Date.now() - t0 };
  }
  // Defensive: parsed could be null/undefined or missing expected fields
  if (!parsed || typeof parsed !== 'object') {
    return { status: 'unavailable', detail: 'live verb returned no usable data', elapsed_ms: Date.now() - t0 };
  }

  // Pull only the enrichment fields packet doesn't already have from
  // overlay. Keeps the LIVE block small.
  const enriched = {
    status: 'enriched',
    elapsed_ms: Date.now() - t0,
    last_touched: (parsed.last_touched ?? []).slice(0, 3).map((c) => `${c.sha} ${c.date} ${c.subject ?? ''}`),
    co_consumer_files: (parsed.co_consumer_files ?? []).slice(0, opts.read_first ?? 3),
  };
  return enriched;
}
