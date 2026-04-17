import Css from 'tree-sitter-css';

// CSS extractor keeps the agent-relevant surface narrow to avoid creating
// one node per bare `div` / `color` / etc. We capture the stuff an agent
// actually navigates:
//   - class selectors (`.card`, `.button`) as Class — reusable component-
//     level styling concepts
//   - keyframes animations as Function — named reusable behaviors
//   - @import statements as IMPORTS edges — cross-file dependencies
//
// We intentionally skip id_selector (one-off), tag_name (generic), and
// identifier-level REFERENCES (would flood with every `color`, `margin`,
// etc. property reference).
//
// SCSS / Sass is not supported by tree-sitter-css — that's a separate
// grammar (tree-sitter-scss). Left as follow-up.
function extractImportTarget({ node, source }) {
  // import_statement shape: @import 'path.css'; or @import "path.css";
  // The string lives as a descendant: string_value → string_content.
  const queue = [...node.namedChildren];
  while (queue.length) {
    const child = queue.shift();
    if (child.type === 'string_content') {
      return [source.slice(child.startIndex, child.endIndex).trim()];
    }
    queue.push(...child.namedChildren);
  }
  return [];
}

export default {
  language: 'css',
  parser: Css,
  extensions: ['.css'],
  confidence: {
    node: 0.7,
    import: 0.7,
  },
  symbols: [
    // class_selector and keyframes_statement use named children, not named
    // fields, so we collect via descendantTypes (class_name / keyframes_name)
    // rather than field:.
    {
      type: 'Class',
      nodeTypes: ['class_selector'],
      descendantTypes: ['class_name'],
      confidence: 0.7,
    },
    {
      type: 'Function',
      nodeTypes: ['keyframes_statement'],
      descendantTypes: ['keyframes_name'],
      confidence: 0.75,
    },
  ],
  refs: {
    imports: [
      {
        nodeTypes: ['import_statement'],
        extractTargets: extractImportTarget,
        confidence: 0.75,
      },
    ],
    references: [],
  },
};
