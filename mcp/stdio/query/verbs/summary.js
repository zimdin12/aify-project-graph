import { graphWhereis } from './whereis.js';

// graph_summary is now a thin wrapper over graph_whereis(expand=true)
// Kept for backward compatibility
export async function graphSummary({ repoRoot, symbol }) {
  return graphWhereis({ repoRoot, symbol, expand: true });
}
