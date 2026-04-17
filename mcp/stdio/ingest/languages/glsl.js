import Glsl from 'tree-sitter-glsl';

// tree-sitter-glsl is based on tree-sitter-c, so the AST shape closely
// mirrors c.js: function_definition, call_expression.function,
// preproc_include.path. GLSL adds struct_specifier for user-defined types
// (vertex buffers, uniform blocks), which we lift as Class.
//
// Identifier-level REFERENCES are disabled by default for the same reason
// as cpp.js: shader code is dense with type_identifier noise (vec3, mat4,
// gl_Position) that would flood the refs array without navigational value.
// CALLS, IMPORTS, DEFINES, CONTAINS carry the signal.
export default {
  language: 'glsl',
  parser: Glsl,
  // Covers standard GLSL (.glsl), the per-stage conventions Khronos
  // recommends (.vert/.frag/.geom/.tesc/.tese/.comp), mesh/task shaders,
  // and Vulkan raytracing pipeline stages (.rgen/.rmiss/.rchit/.rahit/.rint/.rcall).
  extensions: [
    '.glsl',
    '.vert', '.frag', '.geom',
    '.tesc', '.tese',
    '.comp',
    '.mesh', '.task',
    '.rgen', '.rmiss', '.rchit', '.rahit', '.rint', '.rcall',
  ],
  confidence: {
    node: 0.75,
    import: 0.75,
    call: 0.75,
  },
  symbols: [
    {
      type: 'Function',
      nodeTypes: ['function_definition'],
      descendantTypes: ['identifier'],
      signatureFields: ['declarator'],
      confidence: 0.75,
    },
    {
      type: 'Class',
      nodeTypes: ['struct_specifier'],
      field: 'name',
      confidence: 0.75,
    },
  ],
  refs: {
    imports: [
      { nodeTypes: ['preproc_include'], field: 'path', confidence: 0.75 },
    ],
    calls: [
      { nodeTypes: ['call_expression'], field: 'function', confidence: 0.75 },
    ],
    references: [],
  },
};
