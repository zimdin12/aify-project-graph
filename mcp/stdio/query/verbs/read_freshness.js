import { ensureFresh } from '../../freshness/orchestrator.js';

const DEFAULT_PARTIAL_RESUME_LIMIT = 250;

export async function ensureFreshForReadVerb({ repoRoot, verbName, partialResumeLimit = DEFAULT_PARTIAL_RESUME_LIMIT }) {
  const result = await ensureFresh({
    repoRoot,
    allowLargePartialResume: false,
    partialResumeLimit,
  });

  if (!result?.partialResumeDeferred) return null;

  return [
    `GRAPH REBUILD INCOMPLETE — ${verbName} is deferred to avoid a long inline rebuild.`,
    `${result.alreadyProcessedFiles} files already indexed, ${result.pendingFiles} still pending.`,
    'Run graph_index(force=true) before relying on live cross-file graph answers on this repo.',
    'Until then, use briefs/static artifacts for orientation and verify in source files.',
  ].join('\n');
}
