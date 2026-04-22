// C++ framework plugin: Qt signals/slots, Google Test, Catch2.
//
// Three sub-detectors run independently on any .cpp/.h/.hpp/.cc/.cxx file:
//
// 1. **Qt signals/slots** — emit CALLS edges that tree-sitter misses:
//    - `emit signalName(args)` → CALLS signalName
//    - `connect(sender, SIGNAL(sig(T)), recv, SLOT(onSig(T)))` → CALLS on
//      receiver slot (the hidden edge agents need to trace reactive UI)
//    - `connect(sender, &Sender::sig, recv, &Recv::slot)` (Qt5 pointer) →
//      CALLS slot
//
// 2. **Google Test** — TEST(Suite, Name), TEST_F(Fixture, Name),
//    TEST_P(Fixture, Name) all become Test-type nodes with label
//    `Suite.Name` so brief and graph_file pick them up as tests.
//
// 3. **Catch2** — TEST_CASE("desc", "[tags]"), SCENARIO("desc") become
//    Test-type nodes with label = description.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, stableId } from './_plugin_utils.js';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';

function testNode({ filePath, label, startLine }) {
  const qname = `test:${filePath}:${label}`;
  return {
    id: stableId(['Test', filePath, qname]),
    type: 'Test',
    label,
    file_path: filePath,
    start_line: startLine,
    end_line: startLine,
    language: 'cpp',
    confidence: 0.8,
    structural_fp: structuralFingerprint({
      qname, signature: '', decorators: [], parentClass: '', nodeType: 'Test',
    }),
    dependency_fp: dependencyFingerprint({
      outgoing: { calls: [], references: [], usesTypes: [], imports: [] },
    }),
    extra: { qname },
  };
}

function lineOf(content, offset) {
  return (content.slice(0, offset).match(/\n/g) || []).length + 1;
}

// Find the enclosing function/method name for an offset, so Qt emit /
// connect calls can be attributed to the right caller symbol.
//
// Heuristic: the nearest `name(...) {` pattern to the left of the
// offset. Good enough for well-formatted code — edge cases (function
// pointers called `foo(...)`) are acceptable noise.
function enclosingFunction(content, offset) {
  const slice = content.slice(0, offset);
  const defRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{/g;
  let last = null;
  let m;
  while ((m = defRe.exec(slice)) !== null) {
    last = m;
  }
  return last ? last[1] : null;
}

function extractQtSignals(content, rp) {
  const refs = [];

  // `emit signal(args)` — direct signal emission
  for (const m of content.matchAll(/\bemit\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    const caller = enclosingFunction(content, m.index);
    if (!caller) continue;
    refs.push({
      from_target: caller, from_label: caller,
      relation: 'CALLS', target: m[1],
      source_file: rp, source_line: lineOf(content, m.index),
      confidence: 0.72, provenance: 'INFERRED', extractor: 'qt',
    });
  }

  // Qt4-style connect: connect(sender, SIGNAL(sig(...)), receiver, SLOT(slot(...)))
  // We emit CALLS from the signal to the slot (runtime, both signal emission
  // and connect wire them up). Slot name is the identifier inside SLOT(...).
  const connect4Re = /connect\s*\([^,]+,\s*SIGNAL\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\)\s*,\s*[^,]+,\s*SLOT\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  for (const m of content.matchAll(connect4Re)) {
    refs.push({
      from_target: m[1], from_label: m[1],
      relation: 'CALLS', target: m[2],
      source_file: rp, source_line: lineOf(content, m.index),
      confidence: 0.7, provenance: 'INFERRED', extractor: 'qt',
    });
  }

  // Qt5 pointer-to-member: connect(sender, &Sender::sig, receiver, &Recv::slot)
  // Extract bare method names from both &Sender::sig and &Recv::slot.
  const connect5Re = /connect\s*\([^,]+,\s*&[A-Za-z_][A-Za-z0-9_:]*::([A-Za-z_][A-Za-z0-9_]*)\s*,\s*[^,]+,\s*&[A-Za-z_][A-Za-z0-9_:]*::([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const m of content.matchAll(connect5Re)) {
    refs.push({
      from_target: m[1], from_label: m[1],
      relation: 'CALLS', target: m[2],
      source_file: rp, source_line: lineOf(content, m.index),
      confidence: 0.7, provenance: 'INFERRED', extractor: 'qt',
    });
  }

  return refs;
}

function extractGTest(content, rp) {
  const nodes = [];
  // TEST(Suite, Name) | TEST_F(Fixture, Name) | TEST_P(Fixture, Name)
  const re = /\b(TEST|TEST_F|TEST_P)\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  for (const m of content.matchAll(re)) {
    const label = `${m[2]}.${m[3]}`;
    nodes.push(testNode({ filePath: rp, label, startLine: lineOf(content, m.index) }));
  }
  return nodes;
}

function extractCatch2(content, rp) {
  const nodes = [];
  // TEST_CASE("desc", "[tags]") — tags optional
  const re = /\b(TEST_CASE|SCENARIO)\s*\(\s*"([^"]+)"/g;
  for (const m of content.matchAll(re)) {
    nodes.push(testNode({ filePath: rp, label: m[2], startLine: lineOf(content, m.index) }));
  }
  return nodes;
}

async function hasCppIndicators(repoRoot) {
  // Detect presence of any C/C++ source. We don't gate on a specific
  // framework — it's cheap to scan a handful of cpp files for Qt/GTest
  // patterns and emit nothing if none match.
  const samples = await walkFiles(repoRoot, ['.cpp', '.cc', '.cxx', '.h', '.hpp'], { maxFiles: 1 });
  return samples.length > 0;
}

export const cppFrameworksPlugin = createFrameworkPlugin({
  name: 'cpp-frameworks',

  async detect({ repoRoot }) {
    return hasCppIndicators(repoRoot);
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const refs = [...result.refs];

    const files = await walkFiles(repoRoot, ['.cpp', '.cc', '.cxx', '.h', '.hpp']);
    for (const abs of files) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      const rp = relPath(repoRoot, abs);

      // Cheap shape-gates: only run the sub-detector if its canonical
      // token is present. Keeps 90% of C++ files zero-cost.
      if (/\bemit\b|\bconnect\s*\(|Q_OBJECT/.test(content)) {
        refs.push(...extractQtSignals(content, rp));
      }
      if (/\bTEST(_F|_P)?\s*\(/.test(content)) {
        nodes.push(...extractGTest(content, rp));
      }
      if (/\b(TEST_CASE|SCENARIO)\s*\(/.test(content)) {
        nodes.push(...extractCatch2(content, rp));
      }
    }

    return { nodes, edges: result.edges, refs };
  },
});
