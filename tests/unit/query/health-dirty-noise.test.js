// WHEN NOTHING TRACKED IS DIRTY, THE FILE-NAME SAMPLE IS NOISE.
//
// Measured (ef-manager, 2026-08-09) on echoes: graph_health shipped 25 sampled
// dirty-file names costing 537 tokens, EVERY one an untracked backup directory
// (.aify-graph.bak-*, .aify-graph-PRE-RESTORE-*), out of 2824 — while
// trackedDirtyFiles was [], one line, and that is the field carrying the signal.
// Both of his calls that session paid the 537 and neither used it.
//
// graph_health is the verb everyone is told to call first, so its default payload
// is the most-paid response in the product.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'query', 'verbs', 'health.js'),
  'utf8',
);

describe('graph_health omits the dirty-file sample when nothing tracked is dirty', () => {
  it('★ the name list is conditional on trackedDirtyFiles being non-empty', () => {
    expect(src).toMatch(/trackedDirtyFiles\.length > 0/);
  });

  it('★ the COUNT survives unconditionally', () => {
    // Dropping the names is a cost cut; dropping the count would be hiding a
    // fact. A reader must still be able to see that 2824 untracked files exist.
    const i = src.indexOf('trackedDirtyFiles.length > 0');
    expect(src.slice(i, i + 1400)).toMatch(/dirtyFilesTotal: dirtyFiles\.length/);
  });

  it('★ says WHY the names are missing, rather than just omitting them', () => {
    // An absent list is indistinguishable from no dirty files at all — the
    // absent-vs-empty ambiguity this codebase keeps rediscovering.
    expect(src).toMatch(/none of them tracked by git/);
    expect(src).toMatch(/Nothing tracked has moved under the snapshot/);
  });
});
