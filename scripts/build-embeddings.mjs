// scripts/build-embeddings.mjs — opt-in: build the semantic-search embeddings
// sidecar (.aify-graph/embeddings.json) for a repo. Pluggable, OpenAI-compatible
// embeddings endpoint via env (no bundled model):
//   APG_EMBED_ENDPOINT  e.g. http://localhost:11434/v1/embeddings (Ollama) or a cloud URL
//   APG_EMBED_MODEL     e.g. nomic-embed-text / text-embedding-3-small
//   APG_EMBED_API_KEY   optional (cloud providers)
// Usage: node scripts/build-embeddings.mjs [repoRoot]
import { join } from 'node:path';
import { openExistingDb } from '../mcp/stdio/storage/db.js';
import { buildEmbeddings, embedderFromEnv } from '../mcp/stdio/intelligence/embeddings.js';
import { loadIntelligenceOverlays } from '../mcp/stdio/intelligence/overlays.js';

const repoRoot = process.argv[2] || process.cwd();
const embedder = embedderFromEnv();
if (!embedder) {
  console.error('No embedder configured. Set APG_EMBED_ENDPOINT (and APG_EMBED_MODEL / APG_EMBED_API_KEY).');
  console.error('Example (Ollama): APG_EMBED_ENDPOINT=http://localhost:11434/v1/embeddings APG_EMBED_MODEL=nomic-embed-text node scripts/build-embeddings.mjs <repo>');
  process.exit(1);
}

let overlayByPath = null;
try {
  const intel = loadIntelligenceOverlays({ repoRoot });
  if (intel?.semanticFiles?.files) {
    overlayByPath = new Map(intel.semanticFiles.files.map((f) => [f.path, { summary: f.summary, tags: f.tags }]));
  }
} catch { /* overlay optional */ }

const db = openExistingDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
try {
  const r = await buildEmbeddings({ db, repoRoot, embedder, overlayByPath });
  console.log(`Built ${r.count} embeddings (dim=${r.dim}, model=${r.model}) → ${join(repoRoot, '.aify-graph', 'embeddings.json')}`);
  console.log('Query with: graph_search(query="<meaning>", mode="semantic")');
} catch (e) {
  console.error(`Embedding build failed: ${e?.message ?? e}`);
  process.exit(1);
} finally {
  db.close();
}
