// `terminated: true` IS A COMPLETENESS CLAIM, SO IT HAS TO EARN IT.
//
// ef-manager went looking for a case that would make it lie (2026-07-31). His
// predicted mechanism was extension-based terminality — a walk that stops at
// anything that is not .h/.cpp would be defeated by the first .inl/.tpp/.glsl it
// met. He built a GLSL chain to prove it, since this repo's shaders have real
// multi-hop #include.
//
// That defect does not exist: terminality is decided by the GRAPH (the frontier
// ran out of includers), never by file extension, and the walk crossed
// gravity-field.glsl → gravity_helpers.glsl → pcas_powder.comp.glsl correctly.
// His hand-built chain was also wrong on one edge — lbm_fluid.comp.glsl includes
// worldbuf.glsl, not gravity-field.glsl.
//
// ★ But looking for his defect found a REAL one, of exactly the class he was
// hunting: the SQL `LIMIT` clips rows inside SQLite before we count them, and
// `truncated` was only set when the SEEN SET crossed the cap. A hop returning a
// full page of mostly-already-seen files therefore discarded real includers,
// left seen.size well below the cap, and reported `terminated: true` on an
// incomplete closure — false completeness sitting inside the feature built to
// prevent it.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pull = readFileSync(join(here, '../../../mcp/stdio/query/verbs/pull.js'), 'utf8');

describe('recompile surface cannot claim a completeness it did not verify', () => {
  it('treats a full page of SQL rows as truncation', () => {
    // The bug: LIMIT clipped silently and only seen.size gated `truncated`.
    expect(pull).toMatch(/if \(rows\.length >= TRANSITIVE_MAX_FILES\) truncated = true;/);
  });

  it('reports running out of DEPTH budget separately from the file cap', () => {
    expect(pull).toMatch(/const depthCapped = frontier\.length > 0;/);
    expect(pull).toMatch(/depth_capped: depthCapped/);
    expect(pull).toMatch(/CUT OFF at depth/);
  });

  it('only claims terminated when neither budget was exhausted', () => {
    expect(pull).toMatch(/terminated: !truncated && !depthCapped/);
    // The old form inferred terminality from hop count, which said nothing about
    // whether the frontier still had unexplored includers queued.
    expect(pull).not.toMatch(/terminated: !truncated && byDepth\.length < TRANSITIVE_MAX_DEPTH/);
  });

  it('decides terminality from the graph, not from file extension', () => {
    // An extension whitelist is defeated by the first .inl/.glsl/.tpp — the exact
    // failure ef-manager predicted. Terminality must come from edge absence.
    const walk = pull.slice(pull.indexOf('const transitiveImporters'), pull.indexOf('// defines:'));
    expect(walk).not.toMatch(/\.cpp'|\.h'|endsWith\(/);
    expect(walk).toMatch(/e\.relation = 'IMPORTS'/);
  });
});
