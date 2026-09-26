// The join key between an emitted ref and a recorded one — the thing that got three numbers wrong.
//
// WHY THESE TESTS EXIST AND NOT OTHERS. Two conservation audits (`scripts/audit-ref-conservation.mjs`
// and `scripts/audit-ref-conservation-across-run.mjs`) both decide "was this ref lost" by asking whether
// an emitted target string matches a recorded node. Getting that match wrong is silent in both
// directions, and has now done real damage twice:
//
//   * matching on `nodes.label` ONLY made the point-in-time audit publish 90.19% conservation with 4,488
//     phantom IMPORTS losses, because an import's emitted target is a repo-relative PATH.
//   * the same bug made the across-run audit classify a PLANTED, still-emitted IMPORTS loss as
//     "the source stopped referencing it" — a false quiet in the one relation the incremental edge loss
//     primarily destroyed. That is ARM C, and it failed before this key was fixed.
//
// The behavioural proof lives in those audits' arms, which run against a real indexed graph. These tests
// pin the two properties a future edit could quietly revert, and each names the bug it catches.
// ⚠ What they deliberately do NOT do: assert a hand-built node row resembles a real one. The audits'
// arms own that, because only a real index can say what the ingest path actually stores.

import { describe, it, expect } from 'vitest';
import {
  keyOf,
  nodeAddressForms,
  isRecordedModuleWithUnrecordedBinding,
} from '../../scripts/lib/ref-keys.mjs';

describe('nodeAddressForms', () => {
  // CATCHES: the label-only join. A module ref's target is `src/middle.js`; the node's label is
  // `middle.js`. Drop the file_path form and every import in the repo reads as unrecorded.
  it('addresses a File node by its path, not only by its basename label', () => {
    const forms = nodeAddressForms({
      id: 'abc123',
      label: 'middle.js',
      file_path: 'src/middle.js',
    });
    expect(forms).toContain('src/middle.js');
    expect(forms).toContain('middle.js');
  });

  // CATCHES: dropping the per-binding composite, which would move 2,654 refs from a named class back
  // into an unexplained loss headline.
  it('addresses a symbol by path-dot-label, the form a per-binding import target takes', () => {
    expect(nodeAddressForms({ id: 'x', label: 'openExistingDb', file_path: 'mcp/stdio/storage/db.js' }))
      .toContain('mcp/stdio/storage/db.js.openExistingDb');
  });

  // CATCHES: a form built from a missing field, e.g. `undefined.middle` or a bare `.` key, which would
  // match nothing and could collide across unrelated nodes.
  it('contributes only the forms the row actually supports', () => {
    expect(nodeAddressForms({ id: 'x', label: 'freeFunction', file_path: '' }))
      .toEqual(['freeFunction', 'x']);
    expect(nodeAddressForms({ id: '', label: '', file_path: '' })).toEqual([]);
  });
});

describe('isRecordedModuleWithUnrecordedBinding', () => {
  const sourceFile = 'src/outerC.js';

  // CATCHES: folding the per-binding class into the loss count, which is what made the headline 2,690
  // instead of 37.
  it('separates a binding refinement whose module import WAS recorded', () => {
    const recorded = new Set([keyOf(sourceFile, 'IMPORTS', 'src/middle.js')]);
    expect(isRecordedModuleWithUnrecordedBinding({
      recorded, sourceFile, relation: 'IMPORTS', target: 'src/middle.js.middle',
      targetIsRealFile: false,
    })).toBe(true);
  });

  // ⛔ REGRESSION FOR A REAL FALSE EXCUSE, found by graph-senior-dev on a four-file disposable repo
  // with real extraction and real SQLite rows, 2026-09-26. A source named-imports from BOTH
  // './lib.js' and './lib.js.ts', both REAL FILES. Deleting only the IMPORTS edge to File
  // `src/lib.js.ts` is a genuine WHOLE-MODULE loss — but stripping the final `.ts` yields
  // `src/lib.js`, which is recorded because it is a DIFFERENT module. The prefix test alone excused
  // it. A filename may contain dots, so a module path's prefix can coincidentally be another module.
  it('does NOT excuse a lost WHOLE MODULE whose prefix is a different recorded module', () => {
    const consumer = 'src/consumer.js';
    const recorded = new Set([keyOf(consumer, 'IMPORTS', 'src/lib.js')]);
    expect(isRecordedModuleWithUnrecordedBinding({
      recorded,
      sourceFile: consumer,
      relation: 'IMPORTS',
      target: 'src/lib.js.ts',
      targetIsRealFile: true, // it IS a file on disk — that is what makes it a module, not a binding
    })).toBe(false);
  });

  // ⛔ THE ASSERTION THAT MATTERS MOST. A predicate that excused every dotted target would make the
  // audit silent on a genuinely lost import — trading a false alarm for a false quiet, which is worse.
  // Here the module import is NOT recorded, so nothing licenses the excuse.
  it('does NOT excuse a dotted target when the module import was never recorded', () => {
    expect(isRecordedModuleWithUnrecordedBinding({
      recorded: new Set(),
      sourceFile,
      relation: 'IMPORTS',
      target: 'src/middle.js.middle',
    })).toBe(false);
  });

  // CATCHES: widening the excuse beyond IMPORTS. A lost CALLS to a method named `ns.foo` is a real
  // loss, and this repo's own audit output contains exactly that shape
  // (tests/fixtures/code-intel/cpp-fixture-repo/src/bar.cpp:2 -> ns.foo).
  it('never excuses a relation other than IMPORTS, even when a prefix is recorded', () => {
    const recorded = new Set([keyOf('src/bar.cpp', 'CALLS', 'ns')]);
    expect(isRecordedModuleWithUnrecordedBinding({
      recorded, sourceFile: 'src/bar.cpp', relation: 'CALLS', target: 'ns.foo',
    })).toBe(false);
  });

  // CATCHES: an off-by-one on the dot search that would treat a dotless or leading-dot target as a
  // binding refinement of the empty string.
  it('refuses targets with no usable dot split', () => {
    const recorded = new Set([keyOf(sourceFile, 'IMPORTS', '')]);
    for (const target of ['middle', '.middle']) {
      expect(isRecordedModuleWithUnrecordedBinding({
        recorded, sourceFile, relation: 'IMPORTS', target,
      })).toBe(false);
    }
  });
});
