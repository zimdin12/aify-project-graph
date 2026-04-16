import Parser from 'tree-sitter';

const parserCache = new Map();

function getParser(config) {
  if (!config?.language || !config?.parser) {
    throw new Error('walker requires config.language and config.parser');
  }

  let parser = parserCache.get(config.language);
  if (!parser) {
    parser = new Parser();
    parser.setLanguage(config.parser);
    parserCache.set(config.language, parser);
  }

  return parser;
}

export function parseSource({ source, config }) {
  return getParser(config).parse(source);
}

export function walkNamed(node, visitor, parent = null) {
  visitor(node, parent);
  for (const child of node.namedChildren) {
    walkNamed(child, visitor, node);
  }
}

export function nodeText(node, source) {
  if (!node) return '';
  return source.slice(node.startIndex, node.endIndex);
}

export function childText(node, fieldName, source) {
  return nodeText(node?.childForFieldName(fieldName), source);
}
