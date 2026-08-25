// THE FULL MISS LEDGER, OUT OF THE MANIFEST.
//
// the field test, blocked on grading the doc layer: "the manifest stores counts and not the misses
// themselves — I can see how many landed in each, never which." A count nobody can open is
// unfalsifiable from outside, and 707 `noSuchPath` on this repo could be 707 genuine stale doc
// references or 707 mis-bucketed prose tokens with the number reading identically.
//
// ⚠ IT LIVES BESIDE THE MANIFEST RATHER THAN INSIDE IT because every verb reads the manifest on
// every call, and ~1,200 records would make each of them pay for a diagnostic almost none of them
// want. Same reason `dirtyEdges` keeps a 500-row sample with an uncapped `dirtyEdgeCount` next to
// it: the cap must never be able to make the loss look smaller than it is.
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'doc-link-misses.json';

export function docLinkMissSidecarPath(graphDir) {
  return join(graphDir, FILE);
}

// Best-effort: a diagnostic that can fail an index is a diagnostic that gets deleted.
export async function writeDocLinkMissSidecar(graphDir, misses) {
  try {
    await mkdir(graphDir, { recursive: true });
    await writeFile(docLinkMissSidecarPath(graphDir), JSON.stringify({
      // ⚠ The schema is stated so a grader reading this file cold knows what each field means
      // without reading the extractor. `written` is the span EXACTLY as the author typed it —
      // not normalised — because the grading question is what the author meant by it.
      schema: { doc: 'document path', written: 'the span as authored', line: '1-based', rule: 'admission rule that saw it', bucket: 'why it produced no edge' },
      buckets: ['no_such_path', 'not_a_file_reference', 'external', 'fenced_example'],
      total: Array.isArray(misses) ? misses.length : 0,
      misses: Array.isArray(misses) ? misses : [],
    }, null, 1));
    return true;
  } catch {
    return false;
  }
}

export async function readDocLinkMissSidecar(graphDir) {
  try {
    return JSON.parse(await readFile(docLinkMissSidecarPath(graphDir), 'utf8'));
  } catch {
    return null;
  }
}
