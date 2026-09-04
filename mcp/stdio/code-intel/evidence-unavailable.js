// WHY IS CODE-INTEL UNAVAILABLE, AND WHAT WOULD ACTUALLY FIX IT? THOSE ARE TWO FACTS, AND THE
// SECOND WAS BEING GUESSED FROM THE FIRST.
//
// ⛔ ONE REMEDY, WRITTEN FOR ONE FAULT, WAS HANDED TO EVERY FAULT. `renderEvidenceLine` emitted a
// single hardcoded sentence no matter which cause reached it:
//
//     EVIDENCE: tree-sitter+overlay only; code_intel unavailable
//       (<reason>: install clangd or set --no-code-intel to silence)
//
// "install clangd" is the remedy for exactly one cause — `provider_missing`. `no_graph` needs
// `graph_index`; `no_collection` needs `graph_collect_code_intel`; an unreadable database needs
// neither and is not even a fact about the repository.
//
// ⛔ MEASURED, NOT ARGUED. A `.aify-graph/graph.sqlite` holding non-database bytes passes the
// `existsSync` guard, makes `openExistingDb` throw, and the catch left the default in place — so
// the agent was told `no_collection` and sent to install clangd. That cannot fix a corrupt file, so
// the agent re-runs and receives the identical message forever.
//
// ⭐ THE CLASS, and this module is the structural answer rather than a third patched instance:
// *a remedy that cannot address the actual fault is worse than no remedy, because it spends the
// agent's next action on a guaranteed miss.* A cause therefore OWNS its remedy in one place, and a
// cause nobody has written a remedy for inherits nothing.

/**
 * The action that can actually fix each cause. One entry per cause, and the entry is the ONLY place
 * that cause's remedy is written — a second copy is how the two drift apart.
 */
export const UNAVAILABLE_REMEDIES = new Map([
  ['no_graph',
    'no graph has been built for this repo yet — run graph_index'],
  ['no_collection',
    'a graph exists but no code-intel collection has been taken — run graph_collect_code_intel'],
  ['provider_missing',
    'no language server is available for this repo — install clangd, or pass --no-code-intel to silence this line'],
  ['graph_unreadable',
    'the graph database exists but could not be opened (corrupt, locked, or unreadable) — this is NOT evidence about the repo; re-run graph_index to rebuild it'],
  ['evidence_probe_failed',
    'the graph opened but the code-intel evidence probe failed — this is a fault in the tool, NOT a fact about the repo; re-run, and report it if it persists'],
]);

/**
 * ⛔ AN UNRECOGNISED CAUSE IS HANDED NO ACTION. Inheriting a neighbour's remedy is the defect this
 * module exists to remove, so the fail-closed direction is to say that nothing is known and that the
 * absence is therefore unexplained — which is true, and which costs the agent one read instead of
 * one wasted action.
 *
 * @param {string} reason
 * @returns {string} the remedy sentence, never an invented one
 */
export function remedyForUnavailable(reason) {
  return UNAVAILABLE_REMEDIES.get(reason)
    ?? 'no remedy is known for this cause — treat the absence as UNEXPLAINED, not as a fact about the repo';
}
