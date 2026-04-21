import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Scan Document nodes for mentions of known symbol names.
 * Creates MENTIONS edges from Document → Symbol.
 *
 * Runs after the main index is built so we know which symbols exist.
 */
export async function detectMentions(db, repoRoot) {
  // Get all document nodes
  const docs = db.all("SELECT * FROM nodes WHERE type = 'Document'");
  if (docs.length === 0) return { added: 0 };

  // Get all symbol labels (functions, classes, methods) as a lookup set
  const symbols = db.all(
    "SELECT DISTINCT label, id FROM nodes WHERE type IN ('Function', 'Method', 'Class', 'Interface', 'Type', 'Test') AND length(label) > 3"
  );
  if (symbols.length === 0) return { added: 0 };

  // Build a map of label → node id (skip very short names to avoid noise)
  const symbolMap = new Map();
  for (const s of symbols) {
    if (!symbolMap.has(s.label)) {
      symbolMap.set(s.label, s.id);
    }
  }

  let added = 0;

  for (const doc of docs) {
    try {
      const content = await readFile(join(repoRoot, doc.file_path), 'utf8');
      const words = new Set(content.match(/\b[A-Za-z_]\w{3,}\b/g) || []);

      for (const word of words) {
        const targetId = symbolMap.get(word);
        if (targetId && targetId !== doc.id) {
          db.run(
            `INSERT OR IGNORE INTO edges (from_id, to_id, relation, source_file, source_line, confidence, provenance, extractor)
             VALUES ($from_id, $to_id, 'MENTIONS', $source_file, 0, 0.6, 'INFERRED', 'mentions')`,
            { from_id: doc.id, to_id: targetId, source_file: doc.file_path }
          );
          added++;
        }
      }
    } catch {
      // Skip unreadable docs
    }
  }

  return { added };
}
