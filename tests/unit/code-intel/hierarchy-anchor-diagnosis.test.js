// ROOT DEFECT, LAST INSTANCE. "APG emits an UNVERIFIED CAUSE on every
// zero-result path" — four instances across three verbs. graph_search and
// graph_trace were fixed in 3b8c5bd; code_intel_hierarchy was blocked because the
// real cause there IS the anchor position, which needed the identifier-position
// work first (af75407).
//
// `prepareCallHierarchy` answers about the token under the position it is given.
// When it resolves nothing, the cause is almost never "this symbol has no
// hierarchy" — it is that the position was not on an identifier. The old message,
// `(no call hierarchy root at f:l:c)`, reads as a completeness claim the verb
// never made and cannot support.
//
// One file read settles it, and the answer is actionable: the corrected column.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  diagnoseAnchor,
  renderAnchorDiagnosis,
} from '../../../mcp/stdio/query/verbs/code_intel_hierarchy.js';

describe('zero-root anchor diagnosis', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'apg-anchor-'));
    mkdirSync(join(repoRoot, 'src'), { recursive: true });
    writeFileSync(
      join(repoRoot, 'src', 'Builder.cpp'),
      'Builder Builder::build() {\n  return *this;\n}\n',
    );
  });
  afterEach(() => { try { rmSync(repoRoot, { recursive: true, force: true }); } catch {} });

  it('names the real cause when the column is not on an identifier', () => {
    // col 8 is the space between `Builder` and `Builder::build`.
    const d = diagnoseAnchor({
      repoRoot, file: 'src/Builder.cpp', line: 1, col: 8, symbol: 'Builder::build',
    });
    expect(d.verdict).toBe('not_on_identifier');

    const text = renderAnchorDiagnosis(d, 'callers');
    expect(text).toMatch(/not on an identifier/);
    // And it must hand back the fix, not just the complaint.
    expect(text).toMatch(/retry with col=18/);
  });

  it('offers the corrected column pointing at the method, not the return type', () => {
    // The exact defect identifier-position.js fixed: col 1 sits on the RETURN
    // TYPE `Builder`, which is an identifier — so the not-on-identifier branch
    // does not fire — but the suggested column must still be the method name.
    const d = diagnoseAnchor({
      repoRoot, file: 'src/Builder.cpp', line: 1, col: 1, symbol: 'Builder::build',
    });
    expect(d.verdict).toBe('on_identifier');
    expect(d.suggestCol).toBe(18); // 1-based column of `build` after `::`
  });

  it('says CAUSE UNKNOWN and states what it ruled out when the anchor is fine', () => {
    const d = diagnoseAnchor({
      repoRoot, file: 'src/Builder.cpp', line: 1, col: 18, symbol: 'Builder::build',
    });
    expect(d.verdict).toBe('on_identifier');

    const text = renderAnchorDiagnosis(d, 'callers');
    expect(text).toMatch(/CAUSE UNKNOWN/);
    expect(text).toMatch(/Ruled out: the anchor IS on an identifier/);
    // Must NOT assert a cause it did not check.
    expect(text).not.toMatch(/not on an identifier/);
  });

  it('reports a stale anchor past the end of the file', () => {
    const d = diagnoseAnchor({
      repoRoot, file: 'src/Builder.cpp', line: 900, col: 1, symbol: 'Builder::build',
    });
    expect(d.verdict).toBe('line_out_of_range');
    expect(renderAnchorDiagnosis(d, 'callers')).toMatch(/past the end of the file \(4 lines\)/);
  });

  it('claims nothing when the file cannot be read', () => {
    // Silence beats a guess: an unreadable file is not evidence about the anchor.
    expect(diagnoseAnchor({ repoRoot, file: 'src/missing.cpp', line: 1, col: 1 })).toBeNull();
    expect(renderAnchorDiagnosis(null, 'callers')).toBe('');
  });
});
