// L5 Code-Intel v2 — GLSL shader-binding extraction (static, regex-based).
//
// Parses GLSL buffer/uniform block declarations of the shape:
//
//   layout(std430, set = 0, binding = 1) readonly buffer DeltaHeaders {
//   layout(std430, binding = 0) writeonly buffer FluidStepCellsOut
//   layout(binding = 2) uniform CameraBlock {
//
// and yields one descriptor per binding. Both real games use this convention:
//  - echoes:      layout(std430, set = N, binding = M) [readonly|writeonly] buffer <Name> { ... }
//  - sand_castle: layout(std430, binding = M) [readonly|writeonly] buffer <Name>
//
// We deliberately keep this a hand-rolled scanner (not tree-sitter): the
// `layout(...)` qualifier list is whitespace/newline-tolerant and the
// binding/set/access tokens can appear in any order, which a flat regex
// captures more robustly than walking the GLSL AST. push_constant blocks
// (which carry no binding= ) are intentionally skipped — they aren't
// descriptor-set bindings.

// Match a layout(...) qualifier group, an optional memory-qualifier run, the
// `buffer`/`uniform` keyword, then capture the remaining tail up to the block
// opener `{` or the statement terminator `;`. We parse that tail afterward to
// handle BOTH binding forms found in the real games:
//
//   block form:   layout(...binding=N...) readonly buffer DeltaHeaders { ... }
//   opaque form:  layout(...binding=N...) uniform readonly image2D inputImage;
//                 layout(...binding=N...) uniform sampler2D albedoTex;
//
// `[\s\S]` so the layout(...) qualifier list may span lines.
const LAYOUT_BINDING_RE =
  /layout\s*\(([\s\S]*?)\)\s*((?:(?:readonly|writeonly|coherent|volatile|restrict|std430|std140|highp|mediump|lowp)\s+)*)(buffer|uniform)\s+([^;{]*?)\s*([;{])/g;

const BINDING_RE = /\bbinding\s*=\s*(\d+)/;
const SET_RE = /\bset\s*=\s*(\d+)/;
const MEM_QUAL_RE = /\b(readonly|writeonly|coherent|volatile|restrict|highp|mediump|lowp)\b/g;
const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function lineOf(content, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    if (content[i] === '\n') line += 1;
  }
  return line;
}

// Access is derived from the memory qualifiers anywhere in the declaration
// (inside layout(...), between the keyword and the block/type, or before the
// var name in the opaque form). Default with no qualifier is read+write.
function deriveAccess(blob) {
  const readonly = /\breadonly\b/.test(blob);
  const writeonly = /\bwriteonly\b/.test(blob);
  if (readonly && !writeonly) return 'readonly';
  if (writeonly && !readonly) return 'writeonly';
  return 'readwrite';
}

// Classify the binding kind from the opaque-form type token (image/sampler/
// texture/subpassInput). Block forms keep their 'buffer'/'uniform' keyword.
function opaqueKind(typeToken) {
  const t = typeToken.toLowerCase();
  if (t.includes('image')) return 'image';
  if (t.includes('sampler')) return 'sampler';
  if (t.includes('texture')) return 'texture';
  if (t.includes('subpassinput')) return 'subpassInput';
  return 'uniform';
}

/**
 * Extract every binding declaration from GLSL source. Handles both block
 * declarations (`... buffer Name { ... }`) and opaque uniform bindings
 * (`... uniform readonly image2D name;`).
 * @returns {Array<{set:number, binding:number, access:string, block_name:string,
 *                  kind:string, line:number}>}
 */
export function extractGlslBindings(source) {
  const out = [];
  if (!source) return out;
  LAYOUT_BINDING_RE.lastIndex = 0;
  let m;
  while ((m = LAYOUT_BINDING_RE.exec(source)) !== null) {
    const [, layoutInner, midQualifiers, keyword, tail, opener] = m;
    const bindingMatch = BINDING_RE.exec(layoutInner);
    // No binding= → push_constant / location-only block. Not a descriptor-set
    // binding; skip.
    if (!bindingMatch) continue;
    const setMatch = SET_RE.exec(layoutInner);
    const accessBlob = `${layoutInner} ${midQualifiers} ${tail}`;

    let name;
    let kind;
    if (opener === '{') {
      // Block form: the tail is the block name (after stripping any memory
      // qualifiers that may have landed before it).
      const idents = tail.replace(MEM_QUAL_RE, ' ').match(IDENT_RE) ?? [];
      name = idents[idents.length - 1];
      kind = keyword; // 'buffer' | 'uniform' (UBO)
    } else {
      // Opaque form: `[mem-quals] <type> <name>` (optionally `<name>[ ]`).
      // The binding name is the last identifier; the type token is the one
      // before it. Skip plain `uniform float foo;` scalars (no descriptor).
      const stripped = tail.replace(MEM_QUAL_RE, ' ');
      const idents = stripped.match(IDENT_RE) ?? [];
      if (idents.length < 2) continue; // need at least <type> <name>
      name = idents[idents.length - 1];
      const typeToken = idents[idents.length - 2];
      kind = opaqueKind(typeToken);
      // Only opaque descriptor types (image/sampler/texture/subpassInput) are
      // real bindings here; a bare `uniform vec3 x;` is a (legacy) default-
      // block uniform, not a set/binding descriptor — but it had binding= so
      // we keep it as 'uniform'. Conservative: keep.
    }
    if (!name) continue;

    out.push({
      set: setMatch ? Number(setMatch[1]) : 0,
      binding: Number(bindingMatch[1]),
      access: deriveAccess(accessBlob),
      block_name: name,
      kind,
      line: lineOf(source, m.index),
    });
  }
  return out;
}

/**
 * Extract `#include "..."` targets from GLSL source (basename + raw path).
 * The tree-sitter glsl config already emits IMPORTS for preproc_include, so
 * this is only used by the standalone plugin/tests as a cross-check.
 */
export function extractGlslIncludes(source) {
  const out = [];
  if (!source) return out;
  const re = /^[ \t]*#\s*include\s+["<]([^">]+)[">]/gm;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({ target: m[1], line: lineOf(source, m.index) });
  }
  return out;
}
