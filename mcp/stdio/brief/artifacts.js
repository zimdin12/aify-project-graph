// BRIEF INPUTS THAT ARE NOT THE GRAPH — and the module that exists so rendering can be split.
//
// ★ WHY THIS FILE EXISTS AT ALL: `docs/2026-08-12-refactor-proposal.md` proposed extracting the
// five renderers into `brief/render.js` and called that seam "the verified-cleanest" — one
// input, one output, "no back-references into analysis". Auditing it found that FALSE: six
// functions declared outside the render block are called from inside it, and the proposed split
// would have created a CIRCULAR IMPORT — `generator.js` must import `render.js` to call the
// renderers, while `render.js` needs `computeCoverage`, which the proposal left in
// `generator.js`.
//
// ⇒ So the renderers cannot move until their non-graph dependencies land somewhere BOTH sides
// can import. That is this file. It is a prerequisite slice, not a tidy-up, and skipping it
// would have produced a cycle discovered at import time rather than at design time.
//
// WHAT BELONGS HERE: derivations over artifacts the brief consumes — `tasks.json` — plus the
// pure coverage tier. Nothing here touches the graph database; anything that queries `db`
// belongs on the graph-shape side of the seam, which is a later slice.
import { isTaskOpen } from '../overlay/task-status.js';
import { taskFeatureRefs, taskLinkStrength } from '../overlay/quality.js';

// Feature coverage gradient — a composite health tier for brief.json features.
// Per echoes PM 2026-04-21: "features are binary today (resolved/not).
// pcas-simulation (22 tasks, 0 tests) and world-buffer (1 contract, strong
// test coverage) both read ✓." This tier surfaces the gradient.
//
// ⚠ NAME COLLISION, stated because it has already misled a reader: THREE different functions
// in this repo are called `computeCoverage`, with three different signatures —
//   · this one                          ({resolved, declared, taskCount, contractCount})
//   · code-intel/coverage.js            ({language, projectRoot, file, env})
//   · query/coverage-denominator.js     (langScopeRows, verified)
// They are unrelated. The refactor proposal referred to "computeCoverage" without qualification.
export function computeCoverage({ resolved, declared, taskCount, contractCount }) {
  const anchorRatio = declared === 0 ? 1 : resolved / declared;
  if (anchorRatio < 1) return { tier: '🔴', label: 'risk', reason: 'broken anchors' };
  if (taskCount > 20) return { tier: '🔴', label: 'risk', reason: `${taskCount} open tasks` };
  if (taskCount > 10) return { tier: '🟡', label: 'watch', reason: `${taskCount} open tasks` };
  if (contractCount === 0) return { tier: '🟡', label: 'watch', reason: 'no contract binding' };
  return { tier: '🟢', label: 'healthy', reason: 'anchors resolve · has contract · low task overhang' };
}

export function openTasksByFeature(tasksArtifact) {
  const byFeature = new Map();
  for (const t of tasksArtifact?.tasks || []) {
    if (!isTaskOpen(t.status)) continue;
    const featureRefs = taskFeatureRefs(t);
    if (featureRefs.length === 0) continue;
    for (const fid of featureRefs) {
      if (!byFeature.has(fid)) byFeature.set(fid, []);
      byFeature.get(fid).push(t);
    }
  }
  for (const [fid, tasks] of byFeature.entries()) {
    byFeature.set(fid, [...tasks].sort((a, b) => {
      const rank = { strong: 0, mixed: 1, broad: 2, unlinked: 3 };
      const diff = rank[taskLinkStrength(a)] - rank[taskLinkStrength(b)];
      if (diff !== 0) return diff;
      return String(a.id || '').localeCompare(String(b.id || ''));
    }));
  }
  return byFeature;
}

// M4a: count completed tasks per feature so brief.plan.md can show
// progress without listing them all. Open/in-progress are the noisy
// rows; completed counts are a single number.
export function completedTaskCountsByFeature(tasksArtifact) {
  const counts = new Map();
  for (const t of tasksArtifact?.tasks || []) {
    if (!t.status || !/done|complete|closed|resolved|merged|shipped/i.test(t.status)) continue;
    for (const fid of taskFeatureRefs(t)) {
      counts.set(fid, (counts.get(fid) ?? 0) + 1);
    }
  }
  return counts;
}

// Separate accessor for tasks with no feature attribution — brief.plan.md
// surfaces them in their own section instead of silently dropping them
// (dev audit 11b90fb). Shape mirrors openTasksByFeature's filter.
export function openTasksWithoutFeatures(tasksArtifact) {
  const out = [];
  for (const t of tasksArtifact?.tasks || []) {
    if (!isTaskOpen(t.status)) continue;
    if (taskFeatureRefs(t).length === 0) out.push(t);
  }
  return out;
}
