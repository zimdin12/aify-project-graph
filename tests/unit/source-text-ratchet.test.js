// #10 criterion 3: the ratchet on tests that read product source text (tests/helpers/source-text-reads.js, enforced in
// tests/helpers/temp-root.global.js). This file must not read product source itself, or it would be its own finding.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { productSourcePath, readByTestCode, productSourceRead } from '../helpers/source-text-reads.js';
import { sourceTextVerdict } from '../helpers/temp-root.global.js';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const at = (rel) => join(REPO, rel);
const stack = (...frames) => ['Error', ...frames.map((f) => `    at ${f}`)].join('\n');
const MECHANISM = `recordedReadFileSync (${at('tests/helpers/source-text-reads.setup.js')}:22:5)`;

describe('what counts as product source', () => {
  it('★★★ code in the product directories counts, by path or URL', () => {
    expect(productSourcePath(at('mcp/stdio/server.js'))).toBe('mcp/stdio/server.js');
    expect(productSourcePath(at('scripts/run-suite.mjs'))).toBe('scripts/run-suite.mjs');
    expect(productSourcePath(at('bin/apg.js'))).toBe('bin/apg.js');
    expect(productSourcePath(pathToFileURL(at('mcp/stdio/server.js')))).toBe('mcp/stdio/server.js');
  });

  it('★★★ tests, evidence scripts, root config, dependencies, non-code and outside paths do not', () => {
    for (const rel of ['tests/unit/x.test.js', 'docs/evidence/a/run.mjs', 'vitest.config.js', 'node_modules/vitest/x.js',
      '.aify-graph/brief.json', 'mcp/stdio/fixture.log', 'integrations/claude-code/skill/SKILL.md']) {
      expect(productSourcePath(at(rel)), rel).toBeNull();
    }
    expect(productSourcePath(join(REPO, '..', 'elsewhere', 'mcp', 'x.js'))).toBeNull();
    expect(productSourcePath(3)).toBeNull(); // a file descriptor
  });
});

describe('who is reading', () => {
  it('★★★ a read made by test code counts; one made by product code or a module load does not', () => {
    const fromTest = stack(MECHANISM, `${at('tests/unit/query/x.test.js')}:9:3`);
    const fromProduct = stack(MECHANISM, `loadSchema (${at('mcp/stdio/tools/schema.js')}:4:1)`, `${at('tests/unit/x.test.js')}:2:2`);
    const moduleLoad = stack(MECHANISM, 'Module._extensions..js (node:internal/modules/cjs/loader:1:1)', `${at('tests/unit/x.test.js')}:2:2`);
    expect(readByTestCode(fromTest)).toBe(true);
    expect(readByTestCode(fromProduct)).toBe(false);
    expect(readByTestCode(moduleLoad)).toBe(false);
  });

  it('★★ a record names the test file and the source it read; nothing is recorded for a non-product path', () => {
    const fromTest = () => stack(MECHANISM, `${at('tests/unit/query/x.test.js')}:9:3`);
    expect(productSourceRead(at('mcp/stdio/server.js'), fromTest, at('tests/unit/query/x.test.js')))
      .toBe('tests/unit/query/x.test.js\tmcp/stdio/server.js');
    let stackTaken = false;
    expect(productSourceRead(at('tests/fixtures/a.js'), () => { stackTaken = true; return fromTest(); }, 'x')).toBeNull();
    expect(stackTaken, 'the stack is only taken for product paths').toBe(false);
  });
});

describe('the verdict', () => {
  const records = ['tests/unit/a.test.js\tmcp/stdio/server.js', 'tests/unit/b.test.js\tscripts/x.mjs', 'tests/unit/b.test.js\tscripts/y.mjs'];

  it('★★★ a reader not on the list fails, naming what it read; listed readers pass and are all printed', () => {
    const planted = sourceTextVerdict(records, new Set(['tests/unit/a.test.js']), 'apg-vitest-x');
    expect(planted.error).toMatch(/1 test file\(s\) read product source text and are not on KNOWN_PRODUCT_SOURCE_READERS/u);
    expect(planted.error).toContain('tests/unit/b.test.js read scripts/x.mjs, scripts/y.mjs');
    const listed = sourceTextVerdict(records, new Set(['tests/unit/a.test.js', 'tests/unit/b.test.js']), 'apg-vitest-x');
    expect(listed.error).toBeNull();
    expect(listed.report).toMatch(/2 test file\(s\) read product source text in apg-vitest-x \(ratchet list: 2\)/u);
    expect(listed.report).toContain('  tests/unit/a.test.js\n  tests/unit/b.test.js\n');
  });
});

describe('the recorder is installed where tests read', () => {
  it('★★★ both import forms a test uses reach the recorder', () => {
    expect(readFileSync.name).toBe('recordedReadFileSync');
    expect(readFile.name).toBe('recordedReadFile');
  });
});
