// Session seed — a compact, per-repo answer to "does this server know anything
// relevant to my question?"
//
// Borrowed concept: understory (Apache-2.0), packages/server/src/mcp/seed.ts.
// Their measured failure: a client model saw only TOOL NAMES, so it answered
// from its own head and never looked — the knowledge sat on disk, invisible.
// Their fix, and the part that matters: seed with what each thing is ABOUT, not
// with filenames, because a question is far likelier to brush against
// "boundary-gradient fluid drag" than against a file called `UnifiedFluid.cpp`.
//
// Our SERVER_INSTRUCTIONS is static: it teaches an agent HOW to call us and says
// nothing about what THIS repo contains. So an agent learns the API and still
// has no reason to believe we hold anything for its task. This closes that.
//
// Deliberately cheap and fail-open: it reads two small artifacts already on
// disk, never touches the graph DB, and returns '' on any problem — a seed is an
// affordance, and must never be able to break `initialize`.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_SEED_CHARS = 2200;
const MAX_FEATURES = 14;

// Prefer a real description; fall back to the id only when there is nothing
// better. A bare list of ids is close to a list of filenames — the exact thing
// their finding says does not fire the "it might know this" instinct.
function describeFeature(f) {
  const id = String(f?.id ?? '').trim();
  if (!id) return null;
  const desc = String(f?.description ?? f?.summary ?? '').trim().replace(/\s+/g, ' ');
  if (!desc) return id;
  const short = desc.length > 130 ? `${desc.slice(0, 127)}…` : desc;
  return `${id} — ${short}`;
}

export function buildSessionSeed(repoRoot) {
  try {
    const dir = join(repoRoot, '.aify-graph');
    if (!existsSync(dir)) return '';

    const lines = [];

    const overlayPath = join(dir, 'functionality.json');
    if (existsSync(overlayPath)) {
      const overlay = JSON.parse(readFileSync(overlayPath, 'utf8'));
      const features = Array.isArray(overlay?.features) ? overlay.features : [];
      const described = features.map(describeFeature).filter(Boolean);
      if (described.length) {
        const shown = described.slice(0, MAX_FEATURES);
        const more = described.length - shown.length;
        lines.push(`This repo's graph covers ${described.length} mapped feature${described.length === 1 ? '' : 's'}:`);
        for (const d of shown) lines.push(`  - ${d}`);
        if (more > 0) lines.push(`  - …and ${more} more (graph_pull / graph_packet for any of them)`);
      }
    }

    // Fall back to the orientation brief's own summary when there is no overlay,
    // so a repo that never ran /graph-build-functionality still gets a seed.
    if (lines.length === 0) {
      const briefPath = join(dir, 'brief.agent.md');
      if (existsSync(briefPath)) {
        const head = readFileSync(briefPath, 'utf8').split('\n').slice(0, 12)
          .map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 6);
        if (head.length) {
          lines.push('This repo has an indexed graph. Orientation summary:');
          for (const h of head) lines.push(`  ${h.length > 140 ? `${h.slice(0, 137)}…` : h}`);
        }
      }
    }

    if (lines.length === 0) return '';

    lines.unshift('REPO CONTENTS (this server already knows the following about THIS repo —'
      + ' if your question touches any of it, query before grepping):');
    let seed = lines.join('\n');
    if (seed.length > MAX_SEED_CHARS) seed = `${seed.slice(0, MAX_SEED_CHARS - 1)}…`;
    return seed;
  } catch {
    return '';
  }
}
