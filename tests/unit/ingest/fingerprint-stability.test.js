import { describe, expect, it } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { fileStructuralFingerprint } from '../../../mcp/stdio/ingest/fingerprint.js';
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

    // ⛔ THE ID RELATION ASSERTION WAS REMOVED HERE, NOT INVERTED.
    //
    // It used to require `beforeNode.id === afterNode.id` across a SIGNATURE edit, which the old
    // name-derived scheme gave for free. A code symbol site id is now the occurrence's declarator
    // ADDRESS, so editing the parameter list moves it. Site identity makes no claim about symbol
    // sameness across two source revisions — that is semantic continuity, and it belongs to the
    // later lineage layer, not to step A.
    //
    // ⚠ AND IT IS NOT REPLACED BY `not.toBe`. A stated non-guarantee asserted as inequality would
    // become a GUARANTEED remint — a different false promise in the opposite direction. Whether
    // the id moves is simply not this test's subject. What the test is for, the structural
    // fingerprint moving on a signature change, is retained below.
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

describe('P1-6 file-level structural fingerprint', () => {
  const fp = (source) => fileStructuralFingerprint(
    extractFile({ filePath: 'src/worker.py', source, config: python }),
  );

  it('is stable across a body-only edit (literal / comment change)', () => {
    expect(fp('def run():\n    return 1\n'))
      .toBe(fp('def run():\n    # comment\n    return 2\n'));
  });

  it('changes when a function signature changes', () => {
    expect(fp('def run():\n    return 1\n'))
      .not.toBe(fp('def run(verbose):\n    return 1\n'));
  });

  it('changes when a call is ADDED in the body (call-set guard)', () => {
    expect(fp('def run():\n    helper()\n'))
      .not.toBe(fp('def run():\n    helper()\n    other()\n'));
  });

  it('changes when a call is REMOVED in the body', () => {
    expect(fp('def run():\n    helper()\n    other()\n'))
      .not.toBe(fp('def run():\n    helper()\n'));
  });

  it('changes when a new symbol/member is added', () => {
    expect(fp('def run():\n    return 1\n'))
      .not.toBe(fp('def run():\n    return 1\n\ndef helper():\n    return 2\n'));
  });
});
