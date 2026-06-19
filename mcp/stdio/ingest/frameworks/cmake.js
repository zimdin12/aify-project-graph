// CMake build-graph extractor (Sand Castle usage report, P1 #3).
//
// The structural (tree-sitter) graph never indexes CMakeLists.txt / *.cmake, so
// "what target builds X / what test registers Y / what does target Z link"
// couldn't resolve — a real gap on a C++ repo where target↔test mapping is how
// the team gates. This plugin parses the CMake files and emits a build graph:
//   BuildTarget  — add_executable / add_library (kind + captured sources in extra)
//   BuildTest    — add_test
//   LINKS edge   — target_link_libraries(target dep…) between two KNOWN targets
//   RUNS edge    — add_test(... COMMAND <target>) → the target it executes
//
// Regex-based and best-effort (consistent with the other framework plugins) —
// it covers the common forms, strips # comments, and only emits edges between
// targets it actually saw (external libs like fmt::fmt produce no dangling edge).
// Source→target file edges are deferred (File node ids are not recomputable in a
// plugin); sources are captured in extra.sources for now.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, extname, basename } from 'node:path';
import { createFrameworkPlugin } from '../extractors/base.js';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { isIgnoredDirName, IGNORED_DIRS } from '../ignored-dirs.js';
import { stableId, relPath } from './_plugin_utils.js';

// Reserved words that appear as positional args in target_link_libraries /
// add_library / add_executable but are NOT targets or sources.
const LINK_SCOPE_KEYWORDS = new Set(['PUBLIC', 'PRIVATE', 'INTERFACE', 'LINK_PUBLIC', 'LINK_PRIVATE']);
const TARGET_TYPE_KEYWORDS = new Set(['STATIC', 'SHARED', 'MODULE', 'INTERFACE', 'OBJECT', 'EXCLUDE_FROM_ALL', 'IMPORTED', 'ALIAS', 'WIN32', 'MACOSX_BUNDLE']);
const SOURCE_EXTS = new Set(['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.hxx', '.inl', '.ipp']);

// Collect CMakeLists.txt + *.cmake files under the repo (skips ignored dirs).
async function collectCmakeFiles(root, { maxFiles = 2000, maxBytes = 1_000_000 } = {}) {
  const out = [];
  const stack = [root];
  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop();
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!isIgnoredDirName(entry.name, IGNORED_DIRS)) stack.push(join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name !== 'CMakeLists.txt' && extname(entry.name) !== '.cmake') continue;
      const abs = join(dir, entry.name);
      try { if ((await stat(abs)).size <= maxBytes) out.push(abs); } catch { /* skip */ }
    }
  }
  return out;
}

// Strip `#` line comments (CMake has no block comments in the common case).
function stripComments(text) {
  return text.replace(/#[^\n]*/g, '');
}

// Split a CMake command's argument blob into whitespace-separated tokens,
// dropping ${VAR} / $<...> expansions we can't resolve statically.
function tokenizeArgs(blob) {
  return blob
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !t.includes('${') && !t.startsWith('$<'));
}

function buildTargetNode({ name, kind, sources, cmakeFile }) {
  const qname = `cmake:target:${name}`;
  return {
    id: stableId(['BuildTarget', cmakeFile, qname]),
    type: 'BuildTarget',
    label: name,
    file_path: cmakeFile,
    start_line: 1,
    end_line: 1,
    language: 'cmake',
    confidence: 0.8,
    structural_fp: structuralFingerprint({ qname, signature: '', decorators: [], parentClass: '', nodeType: 'BuildTarget' }),
    dependency_fp: dependencyFingerprint({ outgoing: { calls: [], references: [], usesTypes: [], imports: [] } }),
    extra: { qname, kind, sources, cmakeFile },
  };
}

function buildTestNode({ name, command, cmakeFile }) {
  const qname = `cmake:test:${name}`;
  return {
    id: stableId(['BuildTest', cmakeFile, qname]),
    type: 'BuildTest',
    label: name,
    file_path: cmakeFile,
    start_line: 1,
    end_line: 1,
    language: 'cmake',
    confidence: 0.8,
    structural_fp: structuralFingerprint({ qname, signature: '', decorators: [], parentClass: '', nodeType: 'BuildTest' }),
    dependency_fp: dependencyFingerprint({ outgoing: { calls: [], references: [], usesTypes: [], imports: [] } }),
    extra: { qname, command, cmakeFile },
  };
}

function edge({ from_id, to_id, relation }) {
  return {
    from_id, to_id, relation,
    // source_file='' so the per-file extraction loop's deleteEdgesByFile (which
    // fires when it processes the non-source CMakeLists.txt) can't reap these —
    // the same pattern virtual-override synthesis uses. clearSpecialNodes still
    // rebuilds the whole CMake edge set each index via node-type incidence.
    source_file: '', source_line: 1,
    confidence: 0.8, provenance: 'INFERRED', extractor: 'cmake',
  };
}

export const cmakePlugin = createFrameworkPlugin({
  name: 'cmake-build-graph',

  async detect({ repoRoot }) {
    // Cheap: root CMakeLists.txt is the overwhelming common case; otherwise scan.
    try { if ((await stat(join(repoRoot, 'CMakeLists.txt'))).isFile()) return true; } catch { /* fall through */ }
    return (await collectCmakeFiles(repoRoot, { maxFiles: 1 })).length > 0;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const edges = [...result.edges];

    const files = await collectCmakeFiles(repoRoot);
    if (files.length === 0) return result;

    // Pass 1: collect every declared target + test (so edges in pass 2 can
    // resolve names → node ids, and we only link KNOWN targets).
    const targetByName = new Map(); // name → node
    const linkPairs = [];           // { from: name, to: name, cmakeFile }
    const testRuns = [];            // { test: node, target: name, cmakeFile }

    for (const abs of files) {
      const cmakeFile = relPath(repoRoot, abs);
      let content;
      try { content = stripComments(await readFile(abs, 'utf8')); } catch { continue; }

      // add_executable(<name> [type…] <sources…>) / add_library(<name> …)
      for (const m of content.matchAll(/\badd_(executable|library)\s*\(([\s\S]*?)\)/gu)) {
        const kind = m[1] === 'library' ? 'library' : 'executable';
        const toks = tokenizeArgs(m[2]);
        if (toks.length === 0) continue;
        const name = toks[0];
        if (!/^[A-Za-z0-9_]+$/.test(name)) continue;
        const sources = toks.slice(1)
          .filter((t) => !TARGET_TYPE_KEYWORDS.has(t) && SOURCE_EXTS.has(extname(t).toLowerCase()));
        if (!targetByName.has(name)) {
          const node = buildTargetNode({ name, kind, sources, cmakeFile });
          targetByName.set(name, node);
          nodes.push(node);
        }
      }

      // add_test(NAME <name> COMMAND <target> …) and the legacy add_test(<name> <cmd>)
      for (const m of content.matchAll(/\badd_test\s*\(([\s\S]*?)\)/gu)) {
        const toks = tokenizeArgs(m[1]);
        let name = null; let command = [];
        const nameIdx = toks.indexOf('NAME');
        const cmdIdx = toks.indexOf('COMMAND');
        if (nameIdx !== -1 && cmdIdx !== -1) {
          name = toks[nameIdx + 1];
          command = toks.slice(cmdIdx + 1);
        } else if (toks.length >= 2) {
          name = toks[0];
          command = toks.slice(1);
        }
        if (!name || !/^[A-Za-z0-9_]+$/.test(name)) continue;
        const node = buildTestNode({ name, command, cmakeFile });
        nodes.push(node);
        if (command[0] && /^[A-Za-z0-9_]+$/.test(command[0])) {
          testRuns.push({ test: node, target: command[0], cmakeFile });
        }
      }

      // target_link_libraries(<target> [scope] <deps…>)
      for (const m of content.matchAll(/\btarget_link_libraries\s*\(([\s\S]*?)\)/gu)) {
        const toks = tokenizeArgs(m[1]);
        if (toks.length < 2) continue;
        const from = toks[0];
        for (const dep of toks.slice(1)) {
          if (LINK_SCOPE_KEYWORDS.has(dep)) continue;
          if (!/^[A-Za-z0-9_]+$/.test(dep)) continue; // skip namespaced/external (fmt::fmt)
          linkPairs.push({ from, to: dep, cmakeFile });
        }
      }
    }

    // Pass 2: materialize edges only between targets we actually saw.
    for (const { from, to, cmakeFile } of linkPairs) {
      const a = targetByName.get(from); const b = targetByName.get(to);
      if (a && b && a.id !== b.id) edges.push(edge({ from_id: a.id, to_id: b.id, relation: 'LINKS', cmakeFile }));
    }
    for (const { test, target, cmakeFile } of testRuns) {
      const t = targetByName.get(target);
      if (t) edges.push(edge({ from_id: test.id, to_id: t.id, relation: 'RUNS', cmakeFile }));
    }

    return { nodes, edges, refs: result.refs };
  },
});
