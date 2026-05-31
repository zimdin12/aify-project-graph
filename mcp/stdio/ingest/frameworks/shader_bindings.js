// L5 Code-Intel v2 — C++ <-> GLSL shader-binding bridge (static).
//
// This framework plugin crosses the seam no general code tool crosses: it
// links a C++ render-pipeline file to the GLSL shader it loads by filename,
// and surfaces each shader's descriptor-set binding table. Runs during
// graph_index (no clangd needed).
//
// Two passes, both pure regex/string scanning so they cost nothing on repos
// without shaders:
//
//   1. GLSL pass — for every shader file, extract each
//      `layout(...binding = M...) [readonly|writeonly] buffer|uniform <Name>`
//      declaration into a `ShaderBinding` node, with a `DECLARES_BINDING`
//      edge from the shader File node -> the ShaderBinding node. Also emits
//      GLSL `#include "..."` as IMPORTS refs (belt-and-suspenders with the
//      tree-sitter glsl config, which already does this).
//
//   2. C++ pass — for every C++ file, find string literals ending in a
//      shader extension (`loadFile("cas.comp.glsl")`, etc.) and emit a
//      `LOADS_SHADER` ref from the C++ File node -> the shader File node
//      (resolved by basename in the resolver). Best-effort: capture
//      `.dstBinding = N` descriptor-write sites as VkBindingWrite records so
//      the verb can show a (heuristic) binding-number contract.

import { createFrameworkPlugin } from '../extractors/base.js';
import { walkFiles, tryReadFile, relPath, stableId } from './_plugin_utils.js';
import { dependencyFingerprint, structuralFingerprint } from '../fingerprint.js';
import { extractGlslBindings, extractGlslIncludes } from '../languages/glsl_bindings.js';

// Shader file extensions (compound `.comp.glsl` handled by endsWith). Mirrors
// languages/glsl.js plus sand_castle's bare `.comp`/`.frag`/etc.
const SHADER_EXTS = [
  '.comp.glsl', '.vert.glsl', '.frag.glsl', '.geom.glsl', '.mesh.glsl', '.task.glsl',
  '.tesc.glsl', '.tese.glsl', '.rgen.glsl', '.rmiss.glsl', '.rchit.glsl',
  '.glsl',
  '.comp', '.vert', '.frag', '.geom', '.mesh', '.task',
  '.tesc', '.tese', '.rgen', '.rmiss', '.rchit', '.rahit', '.rint', '.rcall',
];

// File extensions we walk for the GLSL pass.
const GLSL_WALK_EXTS = [
  '.glsl', '.comp', '.vert', '.frag', '.geom', '.mesh', '.task',
  '.tesc', '.tese', '.rgen', '.rmiss', '.rchit', '.rahit', '.rint', '.rcall',
];

const CPP_WALK_EXTS = ['.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'];

// C++ string literal whose value looks like a shader filename. Captures the
// inner path. We match the trailing extension against SHADER_EXTS rather than
// baking every compound extension into one mega-regex.
const CPP_SHADER_STRING_RE = /"([^"\n]*?\.[A-Za-z][A-Za-z0-9_.]*?)"/g;

function looksLikeShaderPath(value) {
  const lower = value.toLowerCase();
  return SHADER_EXTS.some((ext) => lower.endsWith(ext));
}

function baseName(p) {
  const norm = p.replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

// Recompute the File node id exactly as generic.js#makeBaseNode does so the
// DECLARES_BINDING edge points at the same File node the language extractor
// will (or already did) create. File qname == posix file_path.
function fileNodeId(relativePath) {
  const posix = relativePath.replace(/\\/g, '/');
  return stableId(['File', posix, posix]);
}

function shaderBindingNode({ shaderFile, set, binding, access, blockName, kind, line }) {
  const qname = `shaderbinding:${shaderFile}:${set}.${binding}:${blockName}`;
  return {
    id: stableId(['ShaderBinding', shaderFile, qname]),
    type: 'ShaderBinding',
    label: `binding ${set}.${binding} ${blockName}`,
    file_path: shaderFile,
    start_line: line,
    end_line: line,
    language: 'glsl',
    confidence: 0.8,
    structural_fp: structuralFingerprint({
      qname, signature: '', decorators: [], parentClass: '', nodeType: 'ShaderBinding',
    }),
    dependency_fp: dependencyFingerprint({
      outgoing: { calls: [], references: [], usesTypes: [], imports: [] },
    }),
    extra: {
      qname,
      set,
      binding,
      access,
      block_name: blockName,
      kind,
      shader_file: shaderFile,
    },
  };
}

function lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

// Find the enclosing C++ function/method name for a byte offset, so a
// loadFile("x.glsl") edge can be attributed to the symbol that issues it
// rather than just the file. Same heuristic shape as cpp_frameworks.js.
function enclosingCppSymbol(content, offset) {
  const slice = content.slice(0, offset);
  const defRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\([^()]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:override\s*)?\{/g;
  let last = null;
  let m;
  while ((m = defRe.exec(slice)) !== null) last = m;
  return last ? last[1] : null;
}

// Extract descriptor-write binding numbers: `<expr>.dstBinding = N;` —
// best-effort. We attach the enclosing symbol so the verb can show which C++
// site touches a binding number. We do NOT claim a block_name mapping (the
// binding<->block link lives only in the shader); the verb flags this as
// heuristic.
function extractDescriptorWrites(content, rp) {
  const out = [];
  const re = /\.dstBinding\s*=\s*(\d+)/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push({
      cpp_file: rp,
      binding: Number(m[1]),
      symbol: enclosingCppSymbol(content, m.index),
      line: lineOf(content, m.index),
    });
  }
  return out;
}

export const shaderBindingsPlugin = createFrameworkPlugin({
  name: 'shader-bindings',

  async detect({ repoRoot }) {
    // Cheap: any GLSL-family shader file present.
    const shaders = await walkFiles(repoRoot, GLSL_WALK_EXTS, { maxFiles: 1 });
    return shaders.length > 0;
  },

  async enrich({ repoRoot, result }) {
    const nodes = [...result.nodes];
    const edges = [...result.edges];
    const refs = [...result.refs];

    // ── Pass 1: GLSL bindings + includes ──────────────────────────────
    const shaderFiles = await walkFiles(repoRoot, GLSL_WALK_EXTS);
    const shaderBasenames = new Set();
    for (const abs of shaderFiles) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      const rp = relPath(repoRoot, abs);
      shaderBasenames.add(baseName(rp).toLowerCase());
      const shaderFileId = fileNodeId(rp);

      for (const b of extractGlslBindings(content)) {
        const node = shaderBindingNode({
          shaderFile: rp,
          set: b.set,
          binding: b.binding,
          access: b.access,
          blockName: b.block_name,
          kind: b.kind,
          line: b.line,
        });
        nodes.push(node);
        // Emit DECLARES_BINDING as a ref (with both ids already known) rather
        // than a direct edge. Direct edges inserted during the pre-extract
        // framework pass would be wiped by deleteEdgesByFile() when the GLSL
        // file is (re)processed by the language extractor — they share the
        // shader's source_file. Refs are resolved AFTER that loop, so the
        // edge survives. The resolver passes through refs carrying from_id +
        // to_id verbatim as edges.
        refs.push({
          relation: 'DECLARES_BINDING',
          from_id: shaderFileId,
          to_id: node.id,
          from_label: baseName(rp),
          to_label: node.label,
          source_file: rp,
          source_line: b.line,
          confidence: 0.8,
          provenance: 'EXTRACTED',
          extractor: 'shader-bindings',
        });
      }

      // GLSL #include "other.glsl" -> IMPORTS ref (resolved by file-path
      // suffix against the included shader File node).
      for (const inc of extractGlslIncludes(content)) {
        refs.push({
          from_id: shaderFileId,
          from_label: baseName(rp),
          relation: 'IMPORTS',
          target: inc.target,
          source_file: rp,
          source_line: inc.line,
          confidence: 0.75,
          provenance: 'EXTRACTED',
          extractor: 'shader-bindings',
        });
      }
    }

    if (shaderBasenames.size === 0) {
      return { nodes, edges, refs };
    }

    // ── Pass 2: C++ -> shader loads + descriptor writes ───────────────
    const cppFiles = await walkFiles(repoRoot, CPP_WALK_EXTS);
    for (const abs of cppFiles) {
      const content = await tryReadFile(abs);
      if (!content) continue;
      // Cheap shape-gate: only scan files that mention a shader extension or
      // a descriptor write at all.
      if (!/\.(glsl|comp|vert|frag|geom|mesh|task|tesc|tese|rgen|rmiss|rchit)\b/i.test(content)
          && !/dstBinding/.test(content)) {
        continue;
      }
      const rp = relPath(repoRoot, abs);
      const cppFileId = fileNodeId(rp);

      const seen = new Set();
      CPP_SHADER_STRING_RE.lastIndex = 0;
      let m;
      while ((m = CPP_SHADER_STRING_RE.exec(content)) !== null) {
        const literal = m[1];
        if (!looksLikeShaderPath(literal)) continue;
        const bn = baseName(literal).toLowerCase();
        // Only link to shaders we actually indexed (avoid noise from arbitrary
        // path strings that happen to end in .glsl but don't exist).
        if (!shaderBasenames.has(bn)) continue;
        const line = lineOf(content, m.index);
        const dedupeKey = `${bn}:${line}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const symbol = enclosingCppSymbol(content, m.index);
        // LOADS_SHADER ref: target is the shader basename, resolved against
        // the shader File node by the resolver's file-path-suffix matcher.
        refs.push({
          from_id: cppFileId,
          from_label: baseName(rp),
          relation: 'LOADS_SHADER',
          target: baseName(literal),
          source_file: rp,
          source_line: line,
          confidence: 0.75,
          provenance: 'INFERRED',
          extractor: 'shader-bindings',
          // Carry the enclosing symbol for the verb's loader attribution.
          loader_symbol: symbol ?? '',
        });
      }

      // Descriptor writes are best-effort context, stashed on the C++ File
      // node's extra so graph_shader can surface them without a new node kind.
      const writes = extractDescriptorWrites(content, rp);
      if (writes.length > 0) {
        nodes.push({
          id: stableId(['ShaderDescriptorWrites', rp, rp]),
          type: 'ShaderBinding',
          label: `descriptor writes ${baseName(rp)}`,
          file_path: rp,
          start_line: writes[0].line,
          end_line: writes[writes.length - 1].line,
          language: 'cpp',
          confidence: 0.6,
          structural_fp: '',
          dependency_fp: '',
          extra: {
            qname: `shaderdescwrites:${rp}`,
            descriptor_writes: writes,
            cpp_file: rp,
            kind: 'descriptor_writes',
          },
        });
      }
    }

    return { nodes, edges, refs };
  },
});
