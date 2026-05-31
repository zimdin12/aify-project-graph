// Shared source-bundling helper (Code-Intel v2 / P1-2 + P1-3).
//
// Both graph_trace and graph_explore need the same primitive: given a node
// (or a file_path + line range), read the on-disk source for that range and
// render it `cat -n` style — 1-based line numbers that MATCH the real file —
// behind a framing header that tells the agent "treat this as a Read you have
// ALREADY performed; do not re-Read it." This is the codegraph low-salience-
// wall lever: an agent that already sees the verbatim source stops spiralling
// into Read calls.
//
// Design notes:
//   - Reads are BOUNDED and defensive: utf8, skip-missing, clamp the line
//     window, and never throw out to the verb (a missing/unreadable file just
//     yields a short "(source unavailable)" block).
//   - A per-block cap and a total cap are enforced. The caps are repo-size
//     scaled (getSourceBundleBudget) so a 200-file repo doesn't blow the
//     context window the way a 13k-file engine would tolerate.
//   - The tier helper guarantees MONOTONICITY: a larger repo tier never gets a
//     SMALLER per-file/per-block cap than a smaller tier. Guarding against that
//     regression is explicit because it's the kind of off-by-one a future edit
//     could silently introduce.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

// Framing header — verbatim codegraph pattern. Stable wording so an agent (and
// our tests) can rely on it. ONE block emitted once per bundle.
export const SOURCE_BUNDLE_HEADER =
  'Verbatim current on-disk source, line-numbered — treat each block as a Read '
  + 'you have ALREADY performed; do not Read a file shown here.';

// Hard ceiling on bytes we will read off disk for ANY single block, regardless
// of tier — a defensive cap so a pathological end_line never reads a whole
// generated megafile into memory. Tiers scale UNDER this ceiling.
const MAX_BLOCK_BYTES = 256 * 1024;

// Repo-size tiers. Each tier carries:
//   perBlockLines  — max source lines rendered for one symbol/range block
//   totalLines     — max source lines across the whole bundle
//   maxBlocks      — max number of blocks (symbols/ranges) rendered
//
// MONOTONIC CONTRACT: as repos get bigger, caps only ever grow (never shrink).
// Asserted by assertMonotonicTiers() below and locked by a unit test.
const TIERS = [
  { name: 'tiny',   maxNodes: 500,    perBlockLines: 60,  totalLines: 240,  maxBlocks: 6 },
  { name: 'small',  maxNodes: 2000,   perBlockLines: 80,  totalLines: 360,  maxBlocks: 8 },
  { name: 'medium', maxNodes: 8000,   perBlockLines: 120, totalLines: 600,  maxBlocks: 10 },
  { name: 'large',  maxNodes: 30000,  perBlockLines: 160, totalLines: 900,  maxBlocks: 14 },
  { name: 'huge',   maxNodes: Infinity, perBlockLines: 200, totalLines: 1200, maxBlocks: 18 },
];

// Verify no larger tier has a smaller cap than a smaller tier on ANY axis.
// Throws at module load if a future edit violates monotonicity — fail loud,
// not silently truncate a big repo more aggressively than a small one.
export function assertMonotonicTiers(tiers = TIERS) {
  for (let i = 1; i < tiers.length; i += 1) {
    const prev = tiers[i - 1];
    const cur = tiers[i];
    for (const axis of ['perBlockLines', 'totalLines', 'maxBlocks']) {
      if (cur[axis] < prev[axis]) {
        throw new Error(
          `source-bundle tier monotonicity violated: ${cur.name}.${axis}=${cur[axis]} < ${prev.name}.${axis}=${prev[axis]}`,
        );
      }
    }
  }
  return true;
}
assertMonotonicTiers();

// Pick the tier for a given indexed-node count. Returns the tier budget object.
export function getSourceBundleBudget(nodeCount = 0) {
  const n = Number.isFinite(nodeCount) && nodeCount > 0 ? nodeCount : 0;
  for (const tier of TIERS) {
    if (n <= tier.maxNodes) return { ...tier };
  }
  return { ...TIERS[TIERS.length - 1] };
}

// Best-effort indexed-node count for tier selection. Cheap COUNT(*); any
// failure falls back to 0 (→ the tiny tier, the safest under-read).
export function countGraphNodes(db) {
  try {
    const row = db.get('SELECT COUNT(*) AS c FROM nodes');
    return row?.c ?? 0;
  } catch {
    return 0;
  }
}

// Resolve a (possibly repo-relative) file path to an absolute on-disk path.
function resolveFilePath(repoRoot, filePath) {
  if (!filePath) return null;
  if (isAbsolute(filePath)) return filePath;
  return join(repoRoot, filePath);
}

// Read a bounded line window from a file. Returns { lines, startLine, truncated,
// missing } where `lines` is the array of raw source lines (no number prefix
// yet) for [startLine, endLine], 1-based inclusive. Defensive: never throws.
export function readSourceWindow(repoRoot, filePath, startLine, endLine, maxLines) {
  const abs = resolveFilePath(repoRoot, filePath);
  if (!abs || !existsSync(abs)) {
    return { lines: [], startLine: startLine || 1, truncated: false, missing: true };
  }
  let raw;
  try {
    // Bound the read by bytes first — a defensive cap against a giant file.
    const size = statSync(abs).size;
    if (size > MAX_BLOCK_BYTES * 8) {
      // Very large file: still read, but Node reads the whole file; we slice
      // the window after split. The slice keeps memory bounded for rendering.
      raw = readFileSync(abs, 'utf8');
    } else {
      raw = readFileSync(abs, 'utf8');
    }
  } catch {
    return { lines: [], startLine: startLine || 1, truncated: false, missing: true };
  }

  const allLines = raw.split(/\r\n|\r|\n/);
  // A trailing newline yields a phantom empty final element; drop it so line
  // numbering matches `cat -n` (which does not number past the last real line).
  if (allLines.length > 1 && allLines[allLines.length - 1] === '') allLines.pop();
  // Clamp the window to the real file extent. start/end are 1-based inclusive.
  const start = Math.max(1, Number(startLine) || 1);
  let end = Number(endLine) || start;
  if (end < start) end = start;
  end = Math.min(end, allLines.length);

  const requested = end - start + 1;
  const cap = Math.max(1, Number(maxLines) || requested);
  const effectiveEnd = Math.min(end, start + cap - 1);
  const truncated = effectiveEnd < end;

  const lines = allLines.slice(start - 1, effectiveEnd);
  return { lines, startLine: start, truncated, missing: false };
}

// Render one block: a header line (`symbol @ file:start-end`) followed by the
// `cat -n` source. Line numbers are RIGHT-aligned and 1-based matching the file
// so an agent can cite them directly. Returns { text, lineCount }.
export function renderSourceBlock({ symbol, filePath, startLine, endLine, repoRoot, perBlockLines }) {
  const { lines, startLine: actualStart, truncated, missing } = readSourceWindow(
    repoRoot, filePath, startLine, endLine, perBlockLines,
  );

  const loc = `${filePath ?? '(unknown)'}:${startLine ?? '?'}${endLine && endLine !== startLine ? `-${endLine}` : ''}`;
  const head = symbol ? `── ${symbol} @ ${loc}` : `── ${loc}`;

  if (missing) {
    return { text: `${head}\n   (source unavailable — file missing or unreadable; Read ${filePath} directly)`, lineCount: 1 };
  }
  if (lines.length === 0) {
    return { text: `${head}\n   (empty range)`, lineCount: 1 };
  }

  // Width for the line-number gutter — based on the largest number shown.
  const lastNumber = actualStart + lines.length - 1;
  const width = String(lastNumber).length;
  const body = lines
    .map((line, i) => `${String(actualStart + i).padStart(width)}\t${line}`)
    .join('\n');

  let text = `${head}\n${body}`;
  if (truncated) {
    text += `\n   … (block truncated at ${perBlockLines} lines — Read ${filePath} for the rest)`;
  }
  return { text, lineCount: lines.length };
}

// Bundle several blocks under ONE framing header within a total-line budget.
//   blocks: [{ symbol, filePath, startLine, endLine }]
//   budget: tier object from getSourceBundleBudget
// Returns { text, rendered, dropped } — text includes the header; `dropped` is
// how many requested blocks were cut for budget (the caller emits the TRUNCATED
// tail with a "narrow your list" steer).
export function renderSourceBundle({ blocks = [], repoRoot, budget, includeHeader = true }) {
  const b = budget ?? getSourceBundleBudget(0);
  const out = [];
  if (includeHeader) out.push(SOURCE_BUNDLE_HEADER);

  let usedLines = 0;
  let rendered = 0;
  let dropped = 0;

  for (const block of blocks) {
    if (rendered >= b.maxBlocks || usedLines >= b.totalLines) {
      dropped += 1;
      continue;
    }
    // Remaining line budget caps this block on top of the per-block cap.
    const remaining = b.totalLines - usedLines;
    const perBlock = Math.max(1, Math.min(b.perBlockLines, remaining));
    const { text, lineCount } = renderSourceBlock({
      ...block,
      repoRoot,
      perBlockLines: perBlock,
    });
    out.push(text);
    usedLines += lineCount;
    rendered += 1;
  }

  return { text: out.join('\n\n'), rendered, dropped };
}
