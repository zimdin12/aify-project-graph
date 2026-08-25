// The verbs the FULL profile keeps callable but does not list, because something in
// this repo already claims they are redundant.
//
// ⚠ THIS IS NOT THE ONLY UNLISTED SET, and conflating the two cost an hour on
// 2026-08-11. Two independent mechanisms hide verbs from `tools/list`:
//
//   1. THIS SET — hidden even from `--toolset=full`. Eleven verbs, hidden because a
//      comment calls them REDUNDANT with something else. These are deletion
//      candidates: the claim is that they answer a question another verb already
//      answers.
//   2. The DEFAULT PROFILE — fourteen further verbs listed only under
//      `--toolset=full`. These are LONG-TAIL SPECIALISTS (code_intel_hover,
//      graph_shader, graph_tour, …). Nobody claims they are redundant; they are
//      hidden to keep the default surface coherent.
//
// The two sets are DISJOINT, and 11 + 14 = the 25 unlisted verbs in
// the reviewer's scope-3 audit. Only set 1 is a deletion question. A probe aimed
// at "unlisted verbs" would measure both and answer neither.
//
// It lives in its own module so `server.js` and `deprecation-probe.js` derive from ONE
// source. Previously the probe carried its own copy of the list, which is precisely the
// arrangement that lets a twelfth verb be hidden without being probed — and then its
// silence would be indistinguishable from a verb nobody calls.
export const HIDDEN_FULL_TOOL_NAMES = new Set([
  // 1. Legacy locator aliases the briefs replaced.
  'graph_lookup',
  'graph_summary',
  'graph_report',
  // 2. Planning verbs redundant with graph_packet modes — change_plan + preflight
  //    share computeDecision with packet's verify/plan paths.
  'graph_change_plan',
  'graph_preflight',
  // 3. Analytics long-tail — graph_digest is the ONE analytics front door and
  //    composes overview/hotspots/cycles. module_tree folds in as orientation.
  'graph_module_tree',
  'graph_overview',
  'graph_hotspots',
  'graph_cycles',
  // 4. Replay/analyze code-intel long-tail — the live code_intel_* primaries are the
  //    coherent front; these are specialist follow-ups.
  'code_intel_replay',
  'code_intel_analyze',
]);
