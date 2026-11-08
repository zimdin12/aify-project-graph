import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest');

const CASES = [
  {
    name: 'python',
    filePath: 'app.py',
    fixtureDir: 'tiny-python',
    expectedNodeType: 'Function',
    expectedConfidence: 0.95,
    expectedCallConfidence: 0.95,
    expectedImportTarget: 'os',
  },
  {
    name: 'typescript',
    filePath: 'app.ts',
    fixtureDir: 'tiny-typescript',
    expectedNodeType: 'Function',
    expectedConfidence: 0.9,
    expectedCallConfidence: 0.9,
    expectedImportTarget: null,
  },
  {
    name: 'php',
    filePath: 'app.php',
    fixtureDir: 'tiny-php',
    expectedNodeType: 'Function',
    expectedConfidence: 0.75,
    expectedCallConfidence: 0.75,
    expectedImportTarget: 'App\\Http\\Controllers\\HomeController',
  },
  {
    name: 'c',
    filePath: 'app.c',
    fixtureDir: 'tiny-c',
    expectedNodeType: 'Function',
    expectedConfidence: 0.75,
    expectedCallConfidence: 0.75,
    expectedImportTarget: 'stdio.h',
  },
];

describe('language config matrix', () => {
  for (const testCase of CASES) {
    it(`extracts ${testCase.name} fixtures with the expected tier confidence`, async () => {
      const config = getLanguageConfig(testCase.filePath);
      const source = await readFile(join(FIXTURE_ROOT, testCase.fixtureDir, testCase.filePath), 'utf8');

      const result = extractFile({
        filePath: `fixture/${testCase.filePath}`,
        source,
        config,
      });

      const symbolNode = result.nodes.find((node) =>
        node.type === testCase.expectedNodeType && node.label === 'run'
      );
      const callRef = result.refs.find((ref) =>
        ref.relation === 'CALLS' && ref.from_label === 'run'
      );

      expect(config.language).toBe(testCase.name);
      expect(symbolNode).toBeTruthy();
      expect(symbolNode.confidence).toBe(testCase.expectedConfidence);
      expect(callRef).toMatchObject({
        target: 'helper',
        confidence: testCase.expectedCallConfidence,
      });

      if (testCase.expectedImportTarget) {
        expect(result.refs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            relation: 'IMPORTS',
            target: testCase.expectedImportTarget,
          }),
        ]));
      }
    });
  }
});

// ── PHP constructs, asserted on the FINAL graph edges (#15) ─────────────────────────────────────────────────────────
//
// The tier table in README used to say "Tier 2 (70-85%)" for PHP: a goal from the design spec, never a measurement.
// This block is what README now cites instead: each construct below is asserted on the edges the index writes for a
// small fixture repository (tests/fixtures/ingest/matrix-php), expected AND forbidden. It covers these constructs in
// this fixture, not a percentage of real-world PHP.
// Index a fixture repository the way a user would (a git checkout, `apg index`) and read back every edge with both
// ends' type, label and file. A construct claim is about these edges, not about what the extractor emitted.
const indexed = new Map();
function indexFixture(name) {
  const repo = join(mkdtempSync(join(tmpdir(), `apg-matrix-${name}-`)), 'repo');
  cpSync(join(process.cwd(), 'tests', 'fixtures', 'ingest', name), repo, { recursive: true });
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { stdio: 'ignore' });
  git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'fixture');
  execFileSync(process.execPath, [join(process.cwd(), 'bin', 'apg.js'), 'index', repo], { stdio: 'ignore' });
  const db = openExistingDb(join(repo, '.aify-graph', 'graph.sqlite'));
  try {
    indexed.set(name, { repo, edges: db.all(`SELECT f.label AS from_label, f.type AS from_type, f.file_path AS from_file,
      e.relation, t.label AS to_label, t.type AS to_type, t.file_path AS to_file
      FROM edges e JOIN nodes f ON f.id = e.from_id JOIN nodes t ON t.id = e.to_id`) });
  } finally { db.close(); }
}
beforeAll(() => { indexFixture('matrix-php'); indexFixture('matrix-cpp'); }, 180_000);
afterAll(() => {
  for (const { repo } of indexed.values()) { try { rmSync(join(repo, '..'), { recursive: true, force: true }); } catch { /* win lock */ } }
});
const edgesOf = (name) => indexed.get(name).edges;
const edgeIn = (name) => (from, relation, to, toType) => edgesOf(name).filter((e) => e.from_label === from
  && e.relation === relation && e.to_label === to && (!toType || e.to_type === toType));
const edge = edgeIn('matrix-php');
let phpEdges;
beforeAll(() => { phpEdges = edgesOf('matrix-php'); });

describe('PHP constructs (final edges of tests/fixtures/ingest/matrix-php)', () => {
  it('★★★ expected: inheritance by a plain class name, and interface implementation', () => {
    expect(edge('CreditNote', 'EXTENDS', 'Document', 'Class').map((e) => e.to_file)).toEqual(['src/Billing/Document.php']);
    expect(edge('Invoice', 'IMPLEMENTS', 'Totals', 'Class')).toHaveLength(1);
  });

  it('★★★ expected: methods belong to their class, interface or trait', () => {
    for (const [owner, method] of [['Invoice', '__construct'], ['Invoice', 'total'], ['Invoice', 'fee'], ['Totals', 'total'], ['Stamps', 'stamp']]) {
      expect(edge(owner, 'CONTAINS', method, 'Method'), `${owner}::${method}`).toHaveLength(1);
    }
  });

  it('★★★ expected: static calls (`static::`, and through an aliased class) and an instance call on a typed property', () => {
    expect(edge('total', 'CALLS', 'fee', 'Method')).toHaveLength(1);
    expect(edge('fee', 'CALLS', 'zero', 'Method').map((e) => e.to_file)).toEqual(['src/Support/Money.php']);
    expect(edge('total', 'CALLS', 'cents', 'Method').map((e) => e.to_file)).toEqual(['src/Support/Money.php']);
    expect(edge('zero', 'REFERENCES', 'Money', 'Class')).toHaveLength(1);
  });

  it('★★★ forbidden: an untyped call that two methods could answer is not bound to either', () => {
    // `$invoice->total()`: both Totals::total and Invoice::total exist. Picking one would be a guess presented as an edge.
    expect(edge('issue', 'CALLS', 'total', 'Method')).toEqual([]);
    expect(edge('issue', 'CALLS', 'total')).toHaveLength(1); // control: the call is recorded, unresolved
  });

  it('★★★ forbidden (#5 negative control): a Route::get in a repository without Laravel makes no Route node', () => {
    expect(phpEdges.filter((e) => e.to_type === 'Route' || e.from_type === 'Route')).toEqual([]);
  });

  // KNOWN DEFECTS, pinned so they cannot pass silently. `it.fails` turns RED the day the defect is fixed, and the fix
  // must then move the assertion to the expected block above.
  it.fails('KNOWN DEFECT: the parameter `$cents` is bound to the method Money::cents', () => {
    expect(edge('__construct', 'REFERENCES', 'cents', 'Method')).toEqual([]);
    expect(edge('issue', 'REFERENCES', 'cents', 'Method')).toEqual([]);
  });

  // A qualified class name (which is what #4 rewrites an alias to) resolves to the FILE's Module node, not the class the
  // file declares. So `extends BaseDocument` (an alias of App\Billing\Document) lands on the module, and "what extends
  // Document" misses Invoice; the plain `CreditNote extends Document` above lands on the class.
  it.fails('KNOWN DEFECT: an aliased (qualified) class name binds to the file Module, not the class', () => {
    expect(edge('Invoice', 'EXTENDS', 'Document', 'Class')).toHaveLength(1);
    expect(edge('Invoice', 'REFERENCES', 'App.Support.Money', 'Module')).toEqual([]);
  });
});

// ── C++ constructs, on the final edges of tests/fixtures/ingest/matrix-cpp (#15), tree-sitter only (no clangd) ──────
describe('C++ constructs (final edges of tests/fixtures/ingest/matrix-cpp)', () => {
  const cpp = edgeIn('matrix-cpp');
  const edgesFrom = (file, relation) => edgesOf('matrix-cpp').filter((e) => e.from_file === file && e.relation === relation);

  it('★★★ expected: out-of-class definitions belong to their class; inheritance; a virtual override', () => {
    expect(cpp('Shape', 'CONTAINS', 'sides', 'Method').map((e) => e.to_file).sort()).toEqual(['src/shape.cpp', 'src/shape.h']);
    expect(cpp('Shape', 'CONTAINS', 'unit', 'Method').map((e) => e.to_file)).toEqual(['src/shape.cpp']);
    expect(cpp('Square', 'EXTENDS', 'Shape', 'Class').map((e) => e.to_file)).toEqual(['src/shape.h']);
    const overrides = edgesFrom('src/shape.h', 'OVERRIDDEN_BY').filter((e) => e.from_label === 'area');
    expect(overrides.map((e) => e.to_file).sort()).toEqual(['src/shape.cpp', 'src/shape.h']);
  });

  it('★★★ expected: a qualified static call, a free function call, a template call, and an #include', () => {
    expect(cpp('main', 'CALLS', 'unit', 'Method').map((e) => e.to_file)).toEqual(['src/shape.cpp']);
    expect(cpp('main', 'CALLS', 'report', 'Function')).toHaveLength(1);
    expect(edgesFrom('src/shape.cpp', 'CALLS').filter((e) => e.to_label === 'twice' && e.to_type === 'Function')).toHaveLength(1);
    expect(cpp('main.cpp', 'IMPORTS', 'shape.h', 'File')).toHaveLength(1);
  });

  it('★★★ forbidden: a call through a base reference, which two methods could answer, binds to neither', () => {
    // `shape.area()` on a `const geo::Shape&`: Shape::area and Square::area both exist; only the type system can say.
    expect(cpp('report', 'CALLS', 'area', 'Method')).toEqual([]);
    expect(cpp('report', 'CALLS', 'area')).toHaveLength(1); // control: the call is recorded, unresolved
  });
});
