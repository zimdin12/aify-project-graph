// A CANARY FOR THE CLASS OF BUG WE JUST FIXED.
//
// The import is O(records) and CANNOT be safely truncated: a half-imported
// collection is missing edges, and missing edges read as "no callers" — the exact
// false-absence this tool exists to prevent. So the bound belongs on the INPUT, and
// the budget split already caps the collect phase that produces it.
//
// What the split cannot catch is a per-symbol BLOWUP, where few files yield enormous
// records. On 2026-07-30 guessed identifier positions made clangd answer about the
// wrong symbol and 46 files produced 330,794 records — a 6.3-minute import against a
// 100s budget. The cause is fixed (103020f) and the same batch now yields ~7,400
// records in 2.3s, but the NEXT bug of that class should arrive as a reported
// anomaly rather than a mysterious stall.
//
// Warns rather than refuses: a genuinely huge repo is allowed to be huge, and
// refusing on a heuristic would block real work.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/query/verbs/collect_code_intel.js'),
  'utf8',
);

describe('record-volume canary', () => {
  it('fires on records-per-file, not on absolute record count', () => {
    // Absolute count punishes big repos; per-file isolates the blowup shape.
    // Healthy C++ measures ~50-150/file; the explosion hit ~7,200/file.
    expect(src).toMatch(/const RECORDS_PER_FILE_ANOMALY = \d+/);
    expect(src).toMatch(/perFile = filesSeen > 0 \? recordCount \/ filesSeen : 0/);
    expect(src).toMatch(/if \(perFile > RECORDS_PER_FILE_ANOMALY\)/);
  });

  it('is checked BEFORE the import, not inferred from its duration', () => {
    const canary = src.indexOf('RECORDS_PER_FILE_ANOMALY)');
    const importCall = src.indexOf('importStats = importV02Collection');
    expect(canary).toBeGreaterThan(-1);
    expect(canary).toBeLessThan(importCall);
  });

  it('warns rather than refusing, and points at the counters that explain it', () => {
    // A refusal on a heuristic would block a legitimately huge repo. The hint must
    // name the two fields that distinguish a blowup from a big project.
    expect(src).toMatch(/notes\.push\(explosionWarning\)/);
    expect(src).toMatch(/record_volume_anomaly/);
    expect(src).toMatch(/positionGuessSkipped/);
    expect(src).toMatch(/refsTruncatedSymbols/);
  });

  it('states the signature it is detecting, so the reader can judge it', () => {
    expect(src).toMatch(/signature of a per-symbol reference blowup, not a large repo/);
  });

  it('records WHY the import is not truncated instead', () => {
    // The reasoning must survive, or someone will "fix" the unbounded import by
    // truncating it and reintroduce false absence.
    expect(src).toMatch(/CANNOT be safely truncated|cannot be safely truncated/);
    expect(src).toMatch(/missing edges read as "no callers"/);
  });
});
