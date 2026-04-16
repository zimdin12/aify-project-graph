import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

const FIXTURE_ROOT = join(process.cwd(), 'tests', 'fixtures', 'ingest');

const CASES = [
  {
    name: 'python',
    filePath: 'app.py',
    fixtureDir: 'tiny-python',
    expectedNodeType: 'Function',
    expectedConfidence: 0.95,
    expectedCallConfidence: 0.95,
    expectedImportTarget: 'os',
  },
  {
    name: 'typescript',
    filePath: 'app.ts',
    fixtureDir: 'tiny-typescript',
    expectedNodeType: 'Function',
    expectedConfidence: 0.9,
    expectedCallConfidence: 0.9,
    expectedImportTarget: null,
  },
  {
    name: 'php',
    filePath: 'app.php',
    fixtureDir: 'tiny-php',
    expectedNodeType: 'Function',
    expectedConfidence: 0.75,
    expectedCallConfidence: 0.75,
    expectedImportTarget: 'App\\Http\\Controllers\\HomeController',
  },
  {
    name: 'c',
    filePath: 'app.c',
    fixtureDir: 'tiny-c',
    expectedNodeType: 'Function',
    expectedConfidence: 0.75,
    expectedCallConfidence: 0.75,
    expectedImportTarget: 'stdio.h',
  },
];

describe('language config matrix', () => {
  for (const testCase of CASES) {
    it(`extracts ${testCase.name} fixtures with the expected tier confidence`, async () => {
      const config = getLanguageConfig(testCase.filePath);
      const source = await readFile(join(FIXTURE_ROOT, testCase.fixtureDir, testCase.filePath), 'utf8');

      const result = extractFile({
        filePath: `fixture/${testCase.filePath}`,
        source,
        config,
      });

      const symbolNode = result.nodes.find((node) =>
        node.type === testCase.expectedNodeType && node.label === 'run'
      );
      const callRef = result.refs.find((ref) =>
        ref.relation === 'CALLS' && ref.from_label === 'run'
      );

      expect(config.language).toBe(testCase.name);
      expect(symbolNode).toBeTruthy();
      expect(symbolNode.confidence).toBe(testCase.expectedConfidence);
      expect(callRef).toMatchObject({
        target: 'helper',
        confidence: testCase.expectedCallConfidence,
      });

      if (testCase.expectedImportTarget) {
        expect(result.refs).toEqual(expect.arrayContaining([
          expect.objectContaining({
            relation: 'IMPORTS',
            target: testCase.expectedImportTarget,
          }),
        ]));
      }
    });
  }
});
