// WHEN A CALLER SET LOOKS WRONG — one owner, consulted by `graph_callers` and `graph_impact`.
//
// ⛔ IT LIVED IN TWO PLACES AND HAD THE SAME HOLE IN BOTH. `callers.js` and `impact.js` carried
// byte-identical copies of this predicate, and `callers.js`'s own comment already said why that is a
// defect: "One owner: fixing one verb and pasting into the other is how the two drift apart."
//
// ⛔ AND THE OLD PREDICATE COULD NOT FIRE ON ITS OWN MOTIVATING CASE. Measured on the real server,
// 2026-09-06: `graph_callers("has")` returned 25 rows at conf=0.90, every one a collision
// (`groups.has(rawId)` on a Map, `new Map().has()` inside `buildIndex`), with NO warning at all. The
// old trigger was
//
//     (trust === 'weak' && resultCount < 10) || (occurrences >= 3 && resultCount < occurrences)
//
// and exactly ONE node in the graph is labelled `has`, so `occurrences = 1` killed the second clause
// while the first wanted FEWER than 10 results against 25+.
//
// ⭐ THE TWO SHAPES ARE MIRROR IMAGES, AND ONLY ONE WAS MODELLED:
//   AMBIGUITY — many symbols share a name, few edges come back. The graph missed cross-file
//               resolution. This is what the old clauses caught.
//   COLLISION — ONE symbol absorbs many spurious inbound edges because its name is also a builtin
//               method. Name-based resolution attributes every `x.has(...)` in the repository to it.
//
// Population measured across the live graph BEFORE the threshold was chosen: leaf <= 4 chars AND
// fan-in >= 10 is 42 of 2578 symbols (1.6%), and that set reads
// `join:755 trim:259 has:253 Set:182 all:159 Map:119 Date:97 add:95 some:93 now:71 exec:70 max:64` —
// every one a JavaScript builtin. `has` is not even the worst case.

/** Short enough that a name-based resolver will collide it with a builtin method. */
const SHORT_NAME_MAX = 4;

/** Below this the weak-trust clause already covers the case, so this one would only add noise. */
const OVERCOUNT_MIN_RESULTS = 10;

/**
 * How to say a result count out loud.
 *
 * ⛔ A CAP IS NOT A COUNT, measured by an A/B on 2026-09-07. `graph_callers("has")` told two agents
 * `CONFIDENCE: 100 callers`. The true answer is 10 call sites in one function, and 100 was never a
 * count at all — it is `EDGE_FETCH_CAP`, which the query saturated. One agent wrote back unprompted:
 * *"the headline number the verb prints is still 100 callers, and 100 is wrong by a factor of 100."*
 *
 * The verb already knew. `edgesTruncated` is computed from a deliberate `LIMIT CAP + 1` and reached
 * the trust banner while never reaching the line that printed the number.
 *
 * ⚠ ONLY WHEN IT ACTUALLY SATURATED. A qualifier on every answer is decoration, and this repository
 * has had to tear out an always-on caveat before.
 */
export function describeResultCount({ resultCount = 0, truncated = false } = {}) {
  if (!truncated) return { text: String(resultCount), isFloor: false };
  return {
    text: `at least ${resultCount} (the fetch cap was reached, so this is a floor, not a total)`,
    isFloor: true,
  };
}

/**
 * The last segment of a qualified name.
 *
 * ⛔ THE LEAF, NEVER THE QUALIFIED NAME. `mcp.stdio.query.verbs.collect_code_intel.has` is 40+
 * characters and collides on `has`. Measuring the whole string would silently exempt every collision
 * that happens to live in a nested namespace — which is all of them.
 */
export function leafName(symbol) {
  const s = String(symbol ?? '');
  const parts = s.split(/::|[.]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : s;
}

/**
 * Does this caller/impact result look wrong enough to warrant a warning?
 *
 * @param {object}  args
 * @param {string}  args.trust            'weak' | 'moderate' | 'strong'
 * @param {number}  args.resultCount      edges actually returned
 * @param {number}  args.occurrences      nodes in the graph carrying this label
 * @param {string}  args.symbol           the queried symbol, qualified or not
 * @param {number}  args.verifiedCount    how many of those edges a compiler resolved. A COUNT,
 *                                       not a flag: one verified edge does not vouch for the rest.
 * @returns {{suspicious: boolean, reason: string|null}}
 */
export function isOvercountSuspicious({
  trust, resultCount = 0, occurrences = 0, symbol = '', verifiedCount = 0,
} = {}) {
  // (a) The IMPACT bench's silent-undercount mode: weak trust and a thin result.
  if (trust === 'weak' && resultCount < OVERCOUNT_MIN_RESULTS) {
    return { suspicious: true, reason: 'thin-on-weak-trust' };
  }

  // (b) More indexed nodes carry this label than edges came back — cross-file resolution likely
  // missed some. AMBIGUITY, and the only shape the predicate used to know about.
  if (occurrences >= 3 && resultCount < occurrences) {
    return { suspicious: true, reason: 'more-nodes-than-results' };
  }

  // (c) ⭐ THE SHAPE THE OLD PREDICATE WAS BLIND TO. A short leaf with a large heuristic caller set
  // is the builtin-method collision.
  //
  // ⛔ EXEMPT COMPILER-RESOLVED RESULTS. An LSP-verified set was resolved by a compiler rather than
  // by name, so it is not a collision, and warning about one would undercut the trust spine's whole
  // purpose.
  //
  // ⛔ BUT THE EXEMPTION IS PER EDGE, NOT PER RESULT. This was gated on `hasVerifiedEdge`, and its
  // producer is `edges.some(...)` — so ONE compiler-resolved edge declared a hundred name-matched
  // ones innocent. The argument in the paragraph above is about a SET; the predicate asked ANY.
  // That is the wrong-noun error this repository keeps paying for, sitting directly under a comment
  // that states the right noun.
  //
  // ⭐ AND `.every()` WOULD BE THE SAME MISTAKE MIRRORED — silent only on a perfectly clean set,
  // shouting at one that is 99% resolved. The collision risk lives in the UNRESOLVED edges, so
  // count those. The exemption then falls out rather than being asserted: a fully verified set has
  // nothing unresolved and cannot trip this.
  const unresolvedResults = Math.max(0, resultCount - verifiedCount);
  if (leafName(symbol).length <= SHORT_NAME_MAX
    && unresolvedResults >= OVERCOUNT_MIN_RESULTS) {
    return { suspicious: true, reason: 'short-name-overcount' };
  }

  return { suspicious: false, reason: null };
}
