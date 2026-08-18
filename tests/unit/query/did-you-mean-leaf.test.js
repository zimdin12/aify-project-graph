// THE PRINTED REASON MUST BE THE REASON.
//
// ⛔ FIELD REPORT (ef-manager). graph_whereis on "engine/rendering/GpuMaterialPalette.h"
// suggested AmbientAudioManager.h and AudioSystem.h, each labelled "[same leaf name]". None of
// them shares a leaf name with the query. The real basis was the ".h" EXTENSION: leafOf()
// splits on "::", "." and "->" and takes the last segment, so the leaf of a file path is its
// extension, and every .h file "matches".
//
// ★ Suggesting neighbours is fine. Labelling the basis wrongly is not, because "same leaf name"
// is a strong enough claim to act on — it says the tool found your identifier somewhere else.
// This is the same defect as everything else fixed this month: the printed basis does not match
// the computation. It just happened to be printing a REASON rather than a NUMBER.
import { describe, it, expect } from 'vitest';
import { rankSuggestions } from '../../../mcp/stdio/query/did-you-mean.js';

const rows = (...labels) => labels.map((label, i) => ({ id: `n${i}`, label, type: 'File' }));

describe('did-you-mean states a basis that is true', () => {
  it('★★★ a shared file EXTENSION is not a shared leaf name', () => {
    const out = rankSuggestions('engine/rendering/GpuMaterialPalette.h',
      rows('engine/audio/AmbientAudioManager.h', 'engine/audio/AudioSystem.h'));
    for (const s of out) {
      expect(s._why, `"${s.label}" shares only the extension with the query`)
        .not.toMatch(/same leaf name/);
    }
  });

  it('★★★ a genuinely shared file name IS reported as one — the positive control', () => {
    // Without this the fix could be "never say same leaf name", which would remove a true and
    // useful signal instead of a false one.
    const out = rankSuggestions('engine/rendering/GpuMaterialPalette.h',
      rows('vendor/copy/GpuMaterialPalette.h'));
    expect(out[0]._why, 'the same basename in another directory is exactly a leaf match')
      .toMatch(/same leaf name/);
  });

  it('★★★ qualified SYMBOL names keep working — the case leafOf was written for', () => {
    // Foo::bar when you asked for bar is the original purpose and must not regress.
    expect(rankSuggestions('bar', [{ id: 'a', label: 'Foo::bar', type: 'Method' }])[0]._why)
      .toMatch(/same leaf name/);
    expect(rankSuggestions('c', [{ id: 'a', label: 'a.b.c', type: 'Method' }])[0]._why)
      .toMatch(/same leaf name/);
  });

  it('★★ a bare filename query is not reduced to its extension either', () => {
    // The path-less form of the same defect: "GpuMaterialPalette.h" alone.
    const out = rankSuggestions('GpuMaterialPalette.h', rows('AmbientAudioManager.h'));
    for (const s of out) expect(s._why).not.toMatch(/same leaf name/);
  });
});
