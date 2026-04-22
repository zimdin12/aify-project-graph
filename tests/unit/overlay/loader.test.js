import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import {
  loadFunctionality,
  validateAnchors,
  featuresForFile,
  hasOverlay,
  overlayPath,
} from '../../../mcp/stdio/overlay/loader.js';

function seedNodes(db, rows) {
  for (const r of rows) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, structural_fp, dependency_fp, extra)
       VALUES ($id, $type, $label, $file_path, 0, 0, 'javascript', 1.0, '', '', '{}')`,
      r,
    );
  }
}

describe('overlay/loader', () => {
  let repoRoot;
  let db;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-overlay-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  });

  afterEach(async () => {
    db.close();
    await rm(repoRoot, { recursive: true, force: true });
  });

  describe('loadFunctionality', () => {
    it('returns empty state when file missing', () => {
      const out = loadFunctionality(repoRoot);
      expect(out.features).toEqual([]);
      expect(out.version).toBe(null);
    });

    it('parses and normalizes features with anchors', async () => {
      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
        version: '0.1',
        features: [
          {
            id: 'auth',
            label: 'Authentication',
            description: 'Session tokens.',
            anchors: { symbols: ['authenticate'], files: ['src/auth/*'] },
            tests: ['tests/test_main.cpp'],
            source: 'user',
          },
        ],
      }));
      const out = loadFunctionality(repoRoot);
      expect(out.version).toBe('0.1');
      expect(out.features).toHaveLength(1);
      expect(out.features[0].id).toBe('auth');
      expect(out.features[0].anchors.symbols).toEqual(['authenticate']);
      expect(out.features[0].tests).toEqual(['tests/test_main.cpp']);
      expect(out.features[0].anchors.routes).toEqual([]); // defaulted
      expect(out.features[0].anchors.docs).toEqual([]);
    });

    it('tolerates malformed json without throwing', async () => {
      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), '{ this is broken');
      const out = loadFunctionality(repoRoot);
      expect(out.features).toEqual([]);
      expect(out.error).toBeDefined();
    });

    it('filters falsy anchor values', async () => {
      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), JSON.stringify({
        features: [{
          id: 'x',
          anchors: { symbols: ['a', '', null, 'b'], files: [] },
        }],
      }));
      const out = loadFunctionality(repoRoot);
      expect(out.features[0].anchors.symbols).toEqual(['a', 'b']);
    });
  });

  describe('hasOverlay', () => {
    it('false when missing', () => {
      expect(hasOverlay(repoRoot)).toBe(false);
    });
    it('true when present', async () => {
      await writeFile(join(repoRoot, '.aify-graph', 'functionality.json'), '{}');
      expect(hasOverlay(repoRoot)).toBe(true);
    });
    it('overlayPath returns expected path', () => {
      expect(overlayPath(repoRoot)).toBe(join(repoRoot, '.aify-graph', 'functionality.json'));
    });
  });

  describe('validateAnchors', () => {
    it('classifies feature as valid when all anchors resolve', () => {
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'authenticate', file_path: 'src/auth/login.js' },
        { id: 'n2', type: 'File', label: 'login.js', file_path: 'src/auth/login.js' },
      ]);
      const features = [{
        id: 'auth', label: 'Auth', description: '',
        anchors: { symbols: ['authenticate'], files: ['src/auth/login.js'], routes: [], docs: [] },
        source: 'user', tags: [],
      }];
      const result = validateAnchors(features, db);
      expect(result.valid).toHaveLength(1);
      expect(result.broken).toHaveLength(0);
      expect(result.valid[0].totalResolved).toBe(2);
    });

    it('classifies feature as broken when >50% anchors missing', () => {
      seedNodes(db, [
        { id: 'n1', type: 'Function', label: 'authenticate', file_path: 'src/auth/login.js' },
      ]);
      const features = [{
        id: 'auth', label: 'Auth', description: '',
        anchors: {
          symbols: ['authenticate', 'nonexistent_a', 'nonexistent_b'],
          files: ['src/auth/missing.js'],
          routes: [], docs: [],
        },
        source: 'user', tags: [],
      }];
      const result = validateAnchors(features, db);
      expect(result.broken).toHaveLength(1);
      expect(result.valid).toHaveLength(0);
      // 1/4 resolved: 1 symbol hit, 2 missing symbols, 1 missing file
      expect(result.broken[0].totalResolved).toBe(1);
      expect(result.broken[0].totalDeclared).toBe(4);
    });

    it('accepts directory anchors (type=Directory) for file globs', () => {
      seedNodes(db, [
        { id: 'd1', type: 'Directory', label: 'skills', file_path: 'integrations/skills' },
      ]);
      const features = [{
        id: 'skills', label: 'Skills', description: '',
        anchors: { symbols: [], files: ['integrations/skills'], routes: [], docs: [] },
        source: 'user', tags: [],
      }];
      const result = validateAnchors(features, db);
      expect(result.valid).toHaveLength(1);
    });

    it('handles glob patterns in file anchors', () => {
      seedNodes(db, [
        { id: 'f1', type: 'File', label: 'a.js', file_path: 'src/auth/a.js' },
        { id: 'f2', type: 'File', label: 'b.js', file_path: 'src/auth/b.js' },
      ]);
      const features = [{
        id: 'auth', label: 'Auth', description: '',
        anchors: { symbols: [], files: ['src/auth/*'], routes: [], docs: [] },
        source: 'user', tags: [],
      }];
      const result = validateAnchors(features, db);
      expect(result.valid).toHaveLength(1);
    });

    it('returns empty valid/broken for no features', () => {
      const result = validateAnchors([], db);
      expect(result.valid).toEqual([]);
      expect(result.broken).toEqual([]);
    });
  });

  describe('featuresForFile', () => {
    const features = [
      { id: 'auth', anchors: { symbols: [], files: ['src/auth/*'], routes: [], docs: [] } },
      { id: 'billing', anchors: { symbols: [], files: ['src/billing/**'], routes: [], docs: [] } },
      { id: 'other', anchors: { symbols: [], files: ['specific/file.js'], routes: [], docs: [] } },
    ];

    it('matches single-segment glob', () => {
      expect(featuresForFile(features, 'src/auth/login.js')).toEqual(['auth']);
    });

    it('does not match across path segments with single *', () => {
      expect(featuresForFile(features, 'src/auth/nested/deep.js')).toEqual([]);
    });

    it('multi-segment glob ** matches across segments', () => {
      expect(featuresForFile(features, 'src/billing/nested/deep.js')).toEqual(['billing']);
    });

    it('exact file match works', () => {
      expect(featuresForFile(features, 'specific/file.js')).toEqual(['other']);
    });

    it('returns empty when no feature matches', () => {
      expect(featuresForFile(features, 'random/path.js')).toEqual([]);
    });

    it('returns all matching feature ids when a file anchors multiple', () => {
      const overlapping = [
        { id: 'a', anchors: { symbols: [], files: ['src/**'], routes: [], docs: [] } },
        { id: 'b', anchors: { symbols: [], files: ['src/shared/*'], routes: [], docs: [] } },
      ];
      expect(featuresForFile(overlapping, 'src/shared/util.js').sort()).toEqual(['a', 'b']);
    });
  });
});
