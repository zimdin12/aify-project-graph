import { ensureFresh } from '../../freshness/orchestrator.js';

export async function graphIndex({ repoRoot, paths, force = false }) {
  return ensureFresh({ repoRoot, force });
}
