// COUNTING WHAT A READER HAS TO REASON ABOUT, NOT WHAT THEY HAVE TO SCROLL PAST.
//
// ⛔ THE OBVIOUS METRIC IS THE WRONG ONE HERE, AND USING IT WOULD ATTACK THIS REPO'S BEST HABIT.
// Physical line counts treat a comment as cost. In this codebase comments are the EVIDENCE — the
// incident that produced a guard, the population a number was counted over, the reason a branch
// must not be "tidied". A budget on physical lines pays an author to delete exactly that.
//
// Measured 2026-09-08 on `mcp/`: 7 files exceed 1000 PHYSICAL lines and ZERO exceed 1000 lines of
// CODE. `query/verbs/health.js` is 2071 physical against 908 code — 56% of it is the record of why
// it is the way it is. "Eight files need refactoring" and "no file exceeds a thousand lines of
// code" are the same corpus described by two different nouns.
//
// ⇒ So the budget counts non-blank, non-comment lines, and the physical figure is reported beside
// it rather than enforced.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Non-blank, non-comment lines.
 *
 * ⚠ WHAT THIS CANNOT SEE, written down because the next reader will assume otherwise: it is a line
 * scanner, not a parser. A `//` inside a string literal or a regex reads as a comment, and a block
 * comment opened inside a template literal is mis-tracked. Both push the count DOWN, which is the
 * unsafe direction for a budget — so the number is a FLOOR on how much code a file holds. It is
 * accurate enough to ratchet and must never be quoted as an exact size.
 */
export function codeLines(text) {
  let n = 0;
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (inBlock) {
      if (line.includes('*/')) inBlock = false;
      continue;
    }
    if (!line) continue;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlock = true;
      continue;
    }
    n += 1;
  }
  return n;
}

/** Every shipped source file under `mcp/`, derived by walking rather than listed. */
export function sourceFiles(root = 'mcp') {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = readdirSync(join(REPO, dir)); } catch { return; }
    for (const entry of entries) {
      if (entry === 'node_modules') continue;
      const rel = `${dir}/${entry}`;
      let st;
      try { st = statSync(join(REPO, rel)); } catch { continue; }
      if (st.isDirectory()) walk(rel);
      else if (/\.(js|mjs)$/.test(entry)) out.push(rel);
    }
  };
  walk(root);
  return out.sort();
}

/** `{ file, code, physical }` for every source file, largest first. */
export function measureSources(root = 'mcp') {
  return sourceFiles(root)
    .map((file) => {
      const text = readFileSync(join(REPO, file), 'utf8');
      return { file, code: codeLines(text), physical: text.split(/\r?\n/).length };
    })
    .sort((a, b) => b.code - a.code);
}
