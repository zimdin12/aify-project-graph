import { join } from 'node:path';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { openDb } from '../../storage/db.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';

export async function graphIndex({ repoRoot, paths, force = false }) {
  const result = await ensureFresh({ repoRoot, force });

  // Loud anchor validation: report unresolved anchors in functionality.json
  // so users can distinguish "all valid" from "never checked". Always emit
  // the field (even with count 0) — that's the "checked and clean" signal.
  try {
    if (hasOverlay(repoRoot)) {
      const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
      try {
        const overlay = loadFunctionality(repoRoot);
        const { broken, valid } = validateAnchors(overlay.features ?? [], db);
        const brokenSample = broken.slice(0, 5).map((b) => ({
          feature: b.feature.id,
          resolved: b.totalResolved,
          declared: b.totalDeclared,
          missing: {
            symbols: b.resolved.missing_symbols.slice(0, 3),
            files: b.resolved.missing_files.slice(0, 3),
          },
        }));
        result.unresolvedAnchors = {
          checkedFeatures: valid.length + broken.length,
          brokenFeatures: broken.length,
          sample: brokenSample,
        };
      } finally {
        db.close();
      }
    } else {
      result.unresolvedAnchors = { checkedFeatures: 0, brokenFeatures: 0, sample: [], note: 'no functionality.json overlay' };
    }
  } catch (err) {
    result.unresolvedAnchors = { error: err.message };
  }

  return result;
}
