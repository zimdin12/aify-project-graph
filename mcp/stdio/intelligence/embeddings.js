// Semantic-search primitives — opt-in, pluggable embeddings (no bundled model,
// keeps the tool build-free). The embedder talks to an OpenAI-compatible
// `/v1/embeddings` endpoint configured by env (works with local Ollama or any
// cloud provider); when unconfigured, callers degrade gracefully to lexical
// search. The embedder is INJECTABLE so tests use a deterministic fake — no
// network in CI.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// items: [{ id, vec, ... }] → top-k sorted by similarity to queryVec, each with
// a `similarity` field attached (original fields preserved).
export function rankBySimilarity(queryVec, items, k = 20) {
  return items
    .map((it) => ({ ...it, similarity: cosineSimilarity(queryVec, it.vec) }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, Math.max(1, k));
}

// The text we embed for a symbol: identity + location + (overlay enrichment if
// present). Keep it compact and stable so embeddings stay comparable.
export function composeSemanticText(node, overlay = null) {
  const parts = [node?.label, node?.type, node?.file_path].filter(Boolean);
  if (overlay?.summary) parts.push(overlay.summary);
  if (Array.isArray(overlay?.tags) && overlay.tags.length) parts.push(overlay.tags.join(' '));
  return parts.join(' — ');
}

// Build an embedder from env, or null when unconfigured (→ graceful degrade).
// APG_EMBED_ENDPOINT (required), APG_EMBED_MODEL (default 'text-embedding-3-small'),
// APG_EMBED_API_KEY (optional — local servers like Ollama need none).
export function embedderFromEnv(env = process.env) {
  const endpoint = env.APG_EMBED_ENDPOINT;
  if (!endpoint) return null;
  const model = env.APG_EMBED_MODEL || 'text-embedding-3-small';
  const apiKey = env.APG_EMBED_API_KEY || null;
  return {
    model,
    async embedTexts(texts) {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ model, input: texts }),
      });
      if (!res.ok) throw new Error(`embedding endpoint ${res.status}`);
      const json = await res.json();
      // OpenAI-compatible: { data: [{ embedding: [...] }, ...] }
      return (json.data || []).map((d) => d.embedding);
    },
  };
}

const EMBEDDINGS_FILE = 'embeddings.json';

export function embeddingsPath(repoRoot) {
  return join(repoRoot, '.aify-graph', EMBEDDINGS_FILE);
}

export function loadEmbeddings(repoRoot) {
  const p = embeddingsPath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

// Build embeddings for first-party symbols and write the sidecar. `embedder`
// is injectable (env embedder in prod, fake in tests). `overlayByPath` is an
// optional Map(file_path → { summary, tags }) from the intelligence overlay.
// Returns { count, dim, model }.
export async function buildEmbeddings({ db, repoRoot, embedder, overlayByPath = null, batchSize = 64 }) {
  if (!embedder) throw new Error('no embedder configured (set APG_EMBED_ENDPOINT)');
  const rows = db.all(
    `SELECT id, label, type, file_path FROM nodes
     WHERE type NOT IN ('File','Module','Directory','Document','Config','External','Repository')
       AND label IS NOT NULL AND label != ''`,
  );
  const vectors = [];
  let dim = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const texts = batch.map((n) => composeSemanticText(n, overlayByPath?.get?.(n.file_path) || null));
    const embs = await embedder.embedTexts(texts);
    for (let j = 0; j < batch.length; j += 1) {
      const vec = embs[j];
      if (!Array.isArray(vec)) continue;
      dim = vec.length;
      vectors.push({ id: batch[j].id, label: batch[j].label, file_path: batch[j].file_path, vec });
    }
  }
  const payload = { model: embedder.model || 'unknown', dim, built_at: null, count: vectors.length, vectors };
  writeFileSync(embeddingsPath(repoRoot), JSON.stringify(payload), 'utf8');
  return { count: vectors.length, dim, model: payload.model };
}
