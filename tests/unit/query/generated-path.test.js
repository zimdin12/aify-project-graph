// P1-5 — unit tests for the generated-file classifier. Positive cases (codegen
// stubs we want down-ranked) and negative cases (hand-written files that merely
// resemble a generated prefix and must NOT match).

import { describe, expect, it } from 'vitest';
import { isGeneratedPath } from '../../../mcp/stdio/query/generated.js';

describe('isGeneratedPath — positive (generated codegen output)', () => {
  const positives = [
    'src/proto/message.pb.cc',
    'src/proto/message.pb.h',
    'moc_widget.cpp',
    'src/ui/moc_mainwindow.cpp',
    'ui_mainwindow.h',
    'build/ui_dialog.h',
    'qrc_resources.cpp',
    'src/qrc_assets.cpp',
    'schema_generated.h',
    'flatbuffers/foo_generated.hpp',
    'reflect/types_generated.cc',
    'render/shaders.gen.h',
    'render/bindings.gen.cpp',
    'lib/models.g.dart',
    'src/generated/api.cpp',
    'generated/api.h',
    'src/__generated__/queries.ts',
  ];
  for (const p of positives) {
    it(`flags ${p}`, () => {
      expect(isGeneratedPath(p)).toBe(true);
    });
  }

  it('normalizes Windows backslashes', () => {
    expect(isGeneratedPath('src\\proto\\message.pb.cc')).toBe(true);
    expect(isGeneratedPath('build\\moc_thing.cpp')).toBe(true);
  });
});

describe('isGeneratedPath — negative (hand-written files)', () => {
  const negatives = [
    'src/main.cpp',
    'src/renderer/Renderer.cpp',
    // The load-bearing false-positive guard: `moc_` prefix must be at a
    // segment boundary — `mocha_helpers.cpp` is hand-written, not Qt moc.
    'tests/mocha_helpers.cpp',
    'src/mocking_framework.cpp',
    // `ui_` only matches `.h`; a hand-written `ui_builder.cpp` is not the Qt
    // uic output convention.
    'src/ui_builder.cpp',
    // `generated` must be a full path segment; `generated_report.cpp` is not.
    'src/generated_report.cpp',
    'src/regenerate.cpp',
    // `.pb` alone is not `.pb.cc`/`.pb.h`
    'src/config.pb.txt',
    'docs/protobuf-guide.md',
  ];
  for (const p of negatives) {
    it(`does NOT flag ${p}`, () => {
      expect(isGeneratedPath(p)).toBe(false);
    });
  }

  it('is safe on empty / nullish input', () => {
    expect(isGeneratedPath('')).toBe(false);
    expect(isGeneratedPath(undefined)).toBe(false);
    expect(isGeneratedPath(null)).toBe(false);
  });
});
