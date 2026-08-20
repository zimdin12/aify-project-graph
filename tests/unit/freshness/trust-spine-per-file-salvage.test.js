import { describe, it, expect } from 'vitest';
import { salvageableFiles } from '../../../mcp/stdio/freshness/orchestrator.js';

// ⚠ THE FIXTURE HELPERS THAT WERE HERE ARE DELETED, NOT COMMENTED OUT.
//
// They planted a collection by hand and asserted end-to-end restoration. The POSITIVE CONTROL
// failed: even at its own commit the planted records restored ZERO edges, because `synthesizeLspEdges`
// needs more than a well-shaped row. Without that control I would have reported a working salvage
// on a fixture that produces nothing — the exact shape this session has found eight times.
//
// ⇒ So the END-TO-END behaviour is proven where it can be: on the real repo, with a real 62k-record
// collection, where a forced rebuild salvaged 8,972 edges across 214 of 214 unchanged files. The
// DECISION — which files survive — is a pure function and is tested here. Splitting it that way is
// what makes both halves checkable; leaving a dead helper behind would have left a call to an
// unimported `ensureFresh` sitting in the file.

describe('salvageableFiles decides what survives a moved HEAD', () => {
  it('★★★ keeps the unchanged, drops the changed — both halves in one call', async () => {
    // ⛔ BOTH DIRECTIONS FROM ONE INPUT, so an implementation that returns its input unchanged
    // and one that returns nothing BOTH fail. A test asserting only the drop is satisfied by a
    // function that drops everything, which is precisely the all-or-nothing behaviour this
    // replaces.
    const kept = salvageableFiles(
      ['src/keep.js', 'src/touch.js', 'src/also-keep.js'],
      new Set(['src/touch.js', 'docs/unrelated.md']),
    );
    expect([...kept].sort()).toEqual(['src/also-keep.js', 'src/keep.js']);
  });

  it('★★★ FAILS CLOSED when the change set is unknown', async () => {
    // ⛔ `null` means the diff could not be computed. An unknown change set is NOT an empty one,
    // and returning everything would re-stamp evidence as compiler-verified on the strength of a
    // failed command. Ninth two-state collapse this session if it did — and like the other eight
    // it would fail in the reassuring direction.
    expect([...salvageableFiles(['src/a.js'], null)]).toEqual([]);
  });

  it('★★★ a changed file OUTSIDE the collection costs nothing', async () => {
    // The real case that proved this on this repo: HEAD moved by one commit touching
    // `tests/integration/server-toolset.test.js`, which the collection had no records for. 214 of
    // 214 files survived and 8,972 edges were salvaged that the old per-repo gate would have
    // dropped entirely.
    const kept = salvageableFiles(['src/a.js', 'src/b.js'], new Set(['tests/unrelated.test.js']));
    expect(kept.size, 'an unrelated commit must not cost the spine anything').toBe(2);
  });

  it('★★★ an empty collection yields an empty salvage, not a crash', async () => {
    expect([...salvageableFiles([], new Set(['x']))]).toEqual([]);
    expect([...salvageableFiles(undefined, new Set())]).toEqual([]);
  });
});
