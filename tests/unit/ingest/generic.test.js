import { describe, expect, it } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import python from '../../../mcp/stdio/ingest/languages/python.js';
import php from '../../../mcp/stdio/ingest/languages/php.js';
import c from '../../../mcp/stdio/ingest/languages/c.js';

function findNode(nodes, type, label) {
  return nodes.find((node) => node.type === type && node.label === label);
}

function findRef(refs, relation, fromLabel, target) {
  return refs.find((ref) =>
    ref.relation === relation
    && ref.from_label === fromLabel
    && ref.target === target
  );
}

describe('generic extractor', () => {
  it('extracts Python symbols, containment edges, imports, and calls', () => {
    const source = [
      'import os',
      '',
      'class Greeter:',
      '    def hello(self, name):',
      '        print(name)',
      '',
      'def run():',
      '    hello("world")',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/greeter.py',
      source,
      config: python,
    });

    expect(findNode(result.nodes, 'File', 'greeter.py')).toBeTruthy();
    expect(findNode(result.nodes, 'Module', 'src.greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Class', 'Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Method', 'hello')).toBeTruthy();
    expect(findNode(result.nodes, 'Function', 'run')).toBeTruthy();

    expect(result.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ relation: 'CONTAINS', from_label: 'src.greeter', to_label: 'greeter.py' }),
        expect.objectContaining({ relation: 'DEFINES', from_label: 'greeter.py', to_label: 'Greeter' }),
        expect.objectContaining({ relation: 'DEFINES', from_label: 'greeter.py', to_label: 'run' }),
        expect.objectContaining({ relation: 'CONTAINS', from_label: 'Greeter', to_label: 'hello' }),
      ]),
    );

    expect(findRef(result.refs, 'IMPORTS', 'greeter.py', 'os')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'hello', 'print')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'hello')).toBeTruthy();
  });

  it('extracts PHP classes, methods, imports, and function calls', () => {
    const source = [
      '<?php',
      'use App\\Http\\Controllers\\HomeController;',
      '',
      'function run() {',
      '  helper();',
      '}',
      '',
      'class Greeter {',
      '  public function hello($name) {',
      '    helper();',
      '  }',
      '}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'app/Greeter.php',
      source,
      config: php,
    });

    expect(findNode(result.nodes, 'File', 'Greeter.php')).toBeTruthy();
    expect(findNode(result.nodes, 'Module', 'app.Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Function', 'run')).toBeTruthy();
    expect(findNode(result.nodes, 'Class', 'Greeter')).toBeTruthy();
    expect(findNode(result.nodes, 'Method', 'hello')).toBeTruthy();

    expect(findRef(result.refs, 'IMPORTS', 'Greeter.php', 'App\\Http\\Controllers\\HomeController')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'helper')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'hello', 'helper')).toBeTruthy();
  });

  it('extracts C functions and include dependencies with tier confidence', () => {
    const source = [
      '#include <stdio.h>',
      '',
      'int helper(void);',
      'int run(void) {',
      '  helper();',
      '  return 0;',
      '}',
      '',
    ].join('\n');

    const result = extractFile({
      filePath: 'src/run.c',
      source,
      config: c,
    });

    const fileNode = findNode(result.nodes, 'File', 'run.c');
    const functionNode = findNode(result.nodes, 'Function', 'run');
    expect(fileNode).toBeTruthy();
    expect(functionNode).toBeTruthy();
    expect(functionNode.confidence).toBe(0.75);

    expect(findRef(result.refs, 'IMPORTS', 'run.c', 'stdio.h')).toBeTruthy();
    expect(findRef(result.refs, 'CALLS', 'run', 'helper')).toMatchObject({
      confidence: 0.75,
      extractor: 'c',
    });
  });
});
