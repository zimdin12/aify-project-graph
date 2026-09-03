// ⛔ A SKIPPED SHAPE SCAN MUST NOT LOOK LIKE A CLEAN ONE.
//
// The candidate-shape detectors only run on an EMPTY caller set — the one answer where an agent is
// deciding whether an absence is real. Over the file cap, `listRepoSourceFiles` returned `[]`,
// `shapeWarningsForEmptyResult` returned `[]` for an empty list, and the agent saw an empty caller
// set with no candidate shapes. That is byte-identical to a scan that ran and found none.
//
// ⚠ THE OVER-CAP TEST'S OWN REASONING ARGUED AGAINST THAT SILENCE. It rejects a truncated sample
// because it "would make 'no candidate shapes found' mean 'none in the first N files' — the silent
// scope-narrowing an agent named as the more expensive failure". Returning [] is the same ambiguity
// narrowed to zero rather than to N. Refusing to truncate was right; refusing to say so was not.
//
// ⚠ AND THE SKIP FIRES ON LARGE C/C++ REPOS — the population this verb exists for. Whether real
// target repos exceed the 2,000-file cap is NOT measured anywhere; what is pinned here is that when
// they do, the agent is told rather than left to read silence as evidence.
import { describe, it, expect } from 'vitest';
import {
  listRepoSourceFiles,
  listRepoSourceScope,
  scanScopeNote,
  shapeWarningsForEmptyResult,
} from '../../../mcp/stdio/code-intel/shape-detectors.js';

const manyFiles = (n) => Array.from({ length: n }, (_, i) => `src/f${i}.cpp`).join('\n');

describe('a shape scan that did not run says so', () => {
  it('★★★ OVER CAP: the scope reports the skip, and the note states it is not evidence', () => {
    const scope = listRepoSourceScope('/repo', { cap: 10, exec: () => manyFiles(30) });
    expect(scope.skipped, 'the skip must be reported, not implied by an empty list').toBe('over_cap');
    expect(scope.files, 'still refuses to hand back a truncated sample').toEqual([]);
    expect(scope.total, 'and it says how many it saw').toBe(30);

    const note = scanScopeNote(scope);
    expect(note).toMatch(/NOT SCANNED/);
    expect(note, 'the number and the cap are what make it actionable').toMatch(/30/);
    expect(note, 'and it must deny the inference an agent would otherwise draw')
      .toMatch(/NOT evidence/i);
  });

  it('⛔ A MEASURED EMPTY IS NOT A SKIP — no note, or this becomes wallpaper', () => {
    // The control that keeps the fix from being unconditional prose. A repo with no C/C++ sources
    // scanned fine and found nothing; saying "not scanned" there would be false AND noisy, which is
    // the failure this module's own header warns about.
    const scope = listRepoSourceScope('/repo', { cap: 10, exec: () => 'README.md\nsrc/app.ts' });
    expect(scope.skipped, 'a clean scan of a repo with no C/C++ sources is not a skip').toBe(null);
    expect(scanScopeNote(scope), 'a measured empty must stay silent').toBe('');
  });

  it('⛔ ENUMERATION FAILURE is disclosed too, not swallowed', () => {
    const scope = listRepoSourceScope('/repo', { exec: () => { throw new Error('git gone'); } });
    expect(scope.skipped).toBe('enumeration_failed');
    expect(scanScopeNote(scope)).toMatch(/NOT SCANNED/);
  });

  it('the old signature still behaves exactly as before — 23 existing tests depend on it', () => {
    // listRepoSourceFiles now delegates to listRepoSourceScope. If that delegation ever returns the
    // scope object instead of the file list, every existing caller silently gets a truthy object
    // where it expects an array.
    expect(listRepoSourceFiles('/repo', { cap: 10, exec: () => manyFiles(30) })).toEqual([]);
    expect(Array.isArray(listRepoSourceFiles('/repo', { cap: 50, exec: () => manyFiles(3) }))).toBe(true);
    expect(listRepoSourceFiles('/repo', { cap: 50, exec: () => manyFiles(3) })).toHaveLength(3);
  });

  it('★★★ POSITIVE CONTROL: an under-cap repo still scans and can still find a shape', async () => {
    // Without this, every assertion above is satisfied by a module that never detects anything.
    // ⚠ FIXTURE COPIED FROM THE DETECTOR'S OWN PASSING TEST, not invented. My first attempt used a
    // plausible-looking `extern int x;` pair and fired nothing — the control caught that my fixture
    // was wrong, which is precisely the job it exists to do. A positive control built on a guess is
    // just a second guess.
    const files = {
      'src/weights.cpp': 'int computeWeight(int x) { return x * 2; }',
      'src/pipeline.cpp': 'extern int computeWeight(int);\nint runWeighting() { return computeWeight(21); }',
    };
    const out = shapeWarningsForEmptyResult({
      files: Object.keys(files), readFile: (f) => files[f],
    });
    expect(out.length, 'the detectors must still fire on a real shape').toBeGreaterThan(0);
    expect(out.join('\n')).toMatch(/CANDIDATE SHAPE/);
  });
});
