// Read-only rejection controls over copies of the frozen manifest. Removes only its own temporary fixtures.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const dir = fileURLToPath(new URL('.', import.meta.url));
const manifestPath = join(dir, 'selection-2026-11-14.v1.json');
const hash = () => createHash('sha256').update(readFileSync(manifestPath)).digest('hex');
const before = hash();
const original = JSON.parse(readFileSync(manifestPath, 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'apg-selection-controls-'));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
try {
  const cases = [
    ['duplicate', (m) => { m.tasks[0] = m.tasks[1]; }, /AssertionError/u],
    ['wrong-feature', (m) => { m.tasks[0].featureIds = ['live-code-intel']; }, /feature membership must be derived/u],
    ['unknown-certified', (m) => { m.audit.eligibilityCertified = true; }, /unknown cannot certify eligibility/u],
    ['cap-overflow', (m) => {
      const commit = git('rev-parse', 'ab1f0887');
      m.tasks[0] = { ...m.tasks[0], commit, base: git('show', '-s', '--format=%P', commit),
        featureIds: ['live-code-intel'], fileAnchor: 'mcp/stdio/code-intel/live.js' };
    }, /selected feature cap exceeded/u],
  ];
  for (const [name, mutate, expected] of cases) {
    const copy = structuredClone(original);
    mutate(copy);
    const path = join(scratch, `${name}.json`);
    writeFileSync(path, JSON.stringify(copy));
    const result = spawnSync(process.execPath, [join(dir, 'verify-selection.mjs'), path], { encoding: 'utf8', cwd: repo });
    assert.equal(result.status, 1, `${name} must refuse`);
    assert.match(`${result.stdout}\n${result.stderr}`, expected, `${name} named refusal`);
    console.log(`${name}: REJECTED with intended assertion`);
  }
  const positive = spawnSync(process.execPath, [join(dir, 'verify-selection.mjs')], { encoding: 'utf8', cwd: repo });
  assert.equal(positive.status, 0, positive.stderr);
  assert.match(positive.stdout, /SELECTION_STRUCTURE_PASS/u);
  assert.equal(hash(), before, 'the frozen manifest must not change');
  console.log('original: PASS; frozen manifest bytes unchanged');
  console.log(`manifestSha256=${before}`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
