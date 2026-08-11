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
  let mtimeMs = null;
  try {
    // Bound the read by bytes first — a defensive cap against a giant file.
    const { size, mtimeMs: mt } = statSync(abs);
    mtimeMs = mt;
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
  return { lines, startLine: start, truncated, missing: false, mtimeMs };
}

// ★ THE OFFSETS ARE FROM THE INDEX. THE BYTES ARE FROM NOW.
//
// `readSourceWindow` reads the CURRENT file at line offsets recorded when the graph
// was built. If lines were inserted or deleted above the symbol since, the window
// slides and we serve a DIFFERENT symbol's body — under a header naming the symbol
// the caller asked for, on the verbs whose entire selling point is
// "Read-equivalent — do NOT re-Read these files".
//
// That is the worst shape a defect can have here: confidently wrong, on the surface
// that tells the reader not to check. Every other stale-data path in this server
// degrades toward silence; this one degrades toward a plausible lie.
//
// Two independent checks, because they fail on different things:
//
//   1. DRIFT PROOF (positive, cheap, no manifest needed). If we were told which
//      symbol this block is, its name must appear somewhere in the returned window.
//      A definition that does not contain its own name is proof the offsets moved.
//      Catches drift even when the file's mtime looks fine.
//
//   2. STALENESS (structural). If the file was modified after the graph was indexed,
//      the offsets are unverified whether or not check 1 happens to pass — a rename
//      elsewhere in the file can slide a window onto a same-named overload.
//
// Check 1 can only fire when a symbol name is available and can false-negative on a
// window that coincidentally contains the name; check 2 cannot see intra-index edits
// but needs no name. Neither subsumes the other, so both run.
// `indexedAt` from the manifest, as epoch ms. Returns null when unreadable — and a
// null here DISABLES the staleness check rather than failing it, deliberately: an
// absent manifest is already reported by the freshness layer, and inventing a second
// warning from it would duplicate a signal instead of adding one. The drift proof
// still runs, because it needs no manifest.
export function manifestIndexedAtMs(repoRoot) {
  try {
    const raw = readFileSync(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8');
    const t = Date.parse(JSON.parse(raw)?.indexedAt ?? '');
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

function verifyWindow({ symbol, lines, mtimeMs, indexedAtMs, verifiable = true }) {
  const warnings = [];
  // `verifiable` is false for File/Directory blocks, whose "symbol" is a filename that
  // the file itself need not contain. See explore.js for the live false positive.
  if (verifiable && symbol && lines.length > 0 && !lines.some((l) => l.includes(symbol))) {
    warnings.push({
      kind: 'offset_drift',
      text: `⛔ WRONG BODY — "${symbol}" does not appear in these lines. The graph's line
   offsets are stale relative to the current file, so this window is some OTHER code.
   Do NOT treat this as ${symbol}. Read the file directly, then graph_index.`,
    });
  }
  if (indexedAtMs && mtimeMs && mtimeMs > indexedAtMs) {
    // ★ THIS WORDING SAID "THE NUMBERING MAY BE OFF". THAT UNDERSTATED IT BY A LOT.
    //
    // ef-manager's adversarial test, 2026-08-11: 200 decoy lines inserted above
    // GpuMaterialPalette::uploadFromRegistry, crafted so the stale window still OPENS
    // with the correct signature and CLOSES with a brace — defeating the drift proof by
    // construction. The served body was entirely fabricated, under a correct signature,
    // and all the reader was told was that line numbers might be off.
    //
    // ★★ THE SEVERITIES WERE ORDERED BY DETECTABILITY, NOT BY HARM. The loud ⛔ fires
    // when the body is OBVIOUSLY wrong — the case a reader would catch unaided. The soft
    // ⚠ fires when it is CONVINCINGLY wrong — the case only this warning can catch.
    // Exactly inverted. So this now names the failure mode rather than its symptom, and
    // says explicitly what the passing drift check does and does not rule out.
    warnings.push({
      kind: 'modified_since_index',
      text: `⛔ UNVERIFIED BODY — this file changed after the graph was indexed. These lines
   are whatever now sits at the recorded offsets: possibly this symbol, possibly a
   DIFFERENT function that opens with a similar signature. The name check passed, which
   rules out only the obvious case, not a plausible one. Do not cite this as ${symbol ?? 'this symbol'}
   without re-Reading the file, or run graph_index.`,
    });
  }
  return warnings;
}

// Render one block: a header line (`symbol @ file:start-end`) followed by the
// `cat -n` source. Line numbers are RIGHT-aligned and 1-based matching the file
// so an agent can cite them directly. Returns { text, lineCount }.
export function renderSourceBlock({ symbol, filePath, startLine, endLine, repoRoot, perBlockLines, indexedAtMs, verifiable = true }) {
  const { lines, startLine: actualStart, truncated, missing, mtimeMs } = readSourceWindow(
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

  const warnings = verifyWindow({ symbol, lines, mtimeMs, indexedAtMs, verifiable });

  // ABOVE the source, not below it. A reader who scans the body and stops has
  // already been misled; a caveat under 40 lines of plausible C++ is decoration.
  const banner = warnings.length > 0 ? `${warnings.map((w) => `   ${w.text}`).join('\n')}\n` : '';
  let text = `${head}\n${banner}${body}`;
  if (truncated) {
    text += `\n   … (block truncated at ${perBlockLines} lines — Read ${filePath} for the rest)`;
  }
  return { text, lineCount: lines.length, warnings };
}

// Bundle several blocks under ONE framing header within a total-line budget.
//   blocks: [{ symbol, filePath, startLine, endLine }]
//   budget: tier object from getSourceBundleBudget
// Returns { text, rendered, dropped } — text includes the header; `dropped` is
// how many requested blocks were cut for budget (the caller emits the TRUNCATED
// tail with a "narrow your list" steer).
export function renderSourceBundle({ blocks = [], repoRoot, budget, includeHeader = true, indexedAtMs }) {
  const b = budget ?? getSourceBundleBudget(0);
  const out = [];
  if (includeHeader) out.push(SOURCE_BUNDLE_HEADER);

  let usedLines = 0;
  let rendered = 0;
  let dropped = 0;
  // Collected so the CALLER can withdraw its "Read-equivalent" promise. A per-block
  // warning under one block does not reach a reader who has already accepted a
  // top-of-response banner telling them not to re-Read anything.
  const unverified = [];

  for (const block of blocks) {
    if (rendered >= b.maxBlocks || usedLines >= b.totalLines) {
      dropped += 1;
      continue;
    }
    // Remaining line budget caps this block on top of the per-block cap.
    const remaining = b.totalLines - usedLines;
    const perBlock = Math.max(1, Math.min(b.perBlockLines, remaining));
    const { text, lineCount, warnings } = renderSourceBlock({
      ...block,
      repoRoot,
      perBlockLines: perBlock,
      indexedAtMs,
    });
    out.push(text);
    usedLines += lineCount;
    rendered += 1;
    // ★ ONE ENTRY PER BLOCK, NOT PER WARNING.
    //
    // This pushed one entry per warning, and explore then rendered
    // `${unverified.length} of ${blocks.length} block(s)`. A single block raising both
    // offset_drift and modified_since_index produced "NOT Read-equivalent for 2 of 1
    // block(s)". Found by ef-manager on a real C++ repo, 2026-08-11.
    //
    // ⚠ AND MY FIXTURE MADE IT UNREACHABLE. The drift test synthesises a stale offset by
    // writing the file and passing the graph's old line numbers — content changes,
    // manifest is absent, so only ONE warning ever fires and the pair never co-occurs.
    // In production they ALWAYS co-occur: a real edit changes content and mtime together.
    // So the condition the test asserts is the one that cannot happen, and the condition
    // that always happens was never tested. A green suite asserting a production-
    // impossible invariant is §3's complaint arriving as a user-visible arithmetic bug.
    if ((warnings ?? []).length > 0) {
      unverified.push({
        symbol: block.symbol,
        filePath: block.filePath,
        kinds: warnings.map((w) => w.kind),
      });
    }
  }

  return { text: out.join('\n\n'), rendered, dropped, unverified };
}
