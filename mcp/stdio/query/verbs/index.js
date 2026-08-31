import { join } from 'node:path';
import { ensureFresh } from '../../freshness/orchestrator.js';
import { writeUnresolvedCategorization } from '../../freshness/unresolved-categorization.js';
import { openDb } from '../../storage/db.js';
import { loadFunctionality, validateAnchors, hasOverlay } from '../../overlay/loader.js';
import { generateBrief } from '../../brief/generator.js';

export async function graphIndex({ repoRoot, paths, force = false }) {
  const result = await ensureFresh({ repoRoot, force });

  // EASE-OF-USE GAP: a full rebuild wipes the [lsp✓] trust spine, and when the
  // stored collection is too stale to restore, the graph silently drops to
  // heuristic-only — measured at 0 verified edges of 17544 CALLS on a real repo,
  // with nothing telling anyone. The agent that just ran this call is exactly who
  // can fix it, so put the remedy at the TOP of the response rather than leaving
  // it to a console warning nobody reads.
  if (result?.trustSpineDropped) {
    result.nextAction = 'run graph_collect_code_intel — this rebuild dropped the [lsp✓] trust spine, so caller sets are heuristic-only and cannot attest exhaustiveness until it is re-collected';
  }

  result.artifacts = {};

  try {
    result.artifacts.briefs = generateBrief({ repoRoot });
    // ⛔ A REFUSAL BURIED IN artifacts.briefs IS A REFUSAL NOBODY READS, and this is the one caller
    // where it is likely: a rebuild is exactly what makes a brief assembly straddle. The receipt
    // says published:false, but a reader scanning the top of the response sees only that graph_index
    // succeeded — and it did; the GRAPH is fine. What is not fine is that the brief on disk still
    // describes an older graph while looking like it was just regenerated.
    //
    // Surfaced the same way trustSpineDropped is, a few lines above, because it is the same shape:
    // the agent that just ran this call is the one who can act on it.
    if (result.artifacts.briefs?.published === false) {
      const note = 'the brief was NOT regenerated — a rebuild committed during each assembly '
        + 'attempt, so every candidate was read from two graphs and all were discarded. The brief '
        + 'on disk is unchanged and now describes an older graph. Re-run graph_index() once the '
        + 'graph stops moving.';
      // Append rather than overwrite: an existing nextAction is about the graph itself, which
      // outranks a stale artifact, and dropping either one to make room loses a real fact.
      result.nextAction = result.nextAction ? `${result.nextAction} — also, ${note}` : note;
    }
  } catch (err) {
    result.artifacts.briefs = { error: err.message };
  }

  try {
    result.artifacts.unresolvedCategorization = await writeUnresolvedCategorization({ repoRoot });
  } catch (err) {
    result.artifacts.unresolvedCategorization = { error: err.message };
  }

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
