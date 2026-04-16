import { describe, expect, it } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import python from '../../../mcp/stdio/ingest/languages/python.js';
import php from '../../../mcp/stdio/ingest/languages/php.js';
import typescript from '../../../mcp/stdio/ingest/languages/typescript.js';

function findNode(nodes, type, label) {
  return nodes.find((node) => node.type === type && node.label === label);
}

describe('extractor fingerprint stability', () => {
  it('keeps Python structural fingerprints stable across body-only edits', () => {
    const before = extractFile({
      filePath: 'src/worker.py',
      source: 'def run():\n    helper()\n',
      config: python,
    });
    const after = extractFile({
      filePath: 'src/worker.py',
      source: 'def run():\n    other_helper()\n',
      config: python,
    });

    const beforeNode = findNode(before.nodes, 'Function', 'run');
    const afterNode = findNode(after.nodes, 'Function', 'run');

    expect(beforeNode.id).toBe(afterNode.id);
    expect(beforeNode.structural_fp).toBe(afterNode.structural_fp);
    expect(beforeNode.dependency_fp).not.toBe(afterNode.dependency_fp);
  });

  it('changes PHP structural fingerprints when the signature changes', () => {
    const before = extractFile({
      filePath: 'app/Greeter.php',
      source: '<?php\nfunction greet($name) { helper(); }\n',
      config: php,
    });
    const after = extractFile({
      filePath: 'app/Greeter.php',
      source: '<?php\nfunction greet($name, $title) { helper(); }\n',
      config: php,
    });

    const beforeNode = findNode(before.nodes, 'Function', 'greet');
    const afterNode = findNode(after.nodes, 'Function', 'greet');

    expect(beforeNode.id).toBe(afterNode.id);
    expect(beforeNode.structural_fp).not.toBe(afterNode.structural_fp);
  });

  it('keeps TypeScript ids stable for unchanged qnames while dependency fingerprints move', () => {
    const before = extractFile({
      filePath: 'src/worker.ts',
      source: 'export function run() { first(); }\n',
      config: typescript,
    });
    const after = extractFile({
      filePath: 'src/worker.ts',
      source: 'export function run() { second(); }\n',
      config: typescript,
    });

    const beforeNode = findNode(before.nodes, 'Function', 'run');
    const afterNode = findNode(after.nodes, 'Function', 'run');

    expect(beforeNode.id).toBe(afterNode.id);
    expect(beforeNode.structural_fp).toBe(afterNode.structural_fp);
    expect(beforeNode.dependency_fp).not.toBe(afterNode.dependency_fp);
  });
});
