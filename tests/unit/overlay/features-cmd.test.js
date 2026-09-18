import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFeaturesCmd } from '../../../mcp/stdio/overlay/features-cmd.js';

const MAP = {
  version: '0.2',
  custom_top_level: 'kept',
  features: [
    { id: 'math', label: 'Math', anchors: { symbols: ['alpha'], files: ['src/math.js'] }, owner_note: 'kept too' },
    { id: 'other', anchors: { files: ['src/math.js'] } },
  ],
};

describe('apg features', () => {
  let repoRoot;
  let out;
  let err;
  const io = () => ({ log: (l) => out.push(l), error: (l) => err.push(l), now: () => new Date('2026-09-18T20:00:00Z') });
  const mapPath = () => join(repoRoot, '.aify-graph', 'functionality.json');
  const readMap = async () => JSON.parse(await readFile(mapPath(), 'utf8'));

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-features-cmd-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'math.js'), 'export function alpha(x) {\n  return x + 1;\n}\n');
    await writeFile(mapPath(), JSON.stringify(MAP, null, 2));
    out = [];
    err = [];
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('confirm stamps only the named feature and keeps every other field', async () => {
    expect(runFeaturesCmd(['confirm', 'math', '--by', 'tester', '--repo', repoRoot], io())).toBe(0);
    const map = await readMap();
    expect(map.custom_top_level).toBe('kept');
    expect(map.features[0].owner_note).toBe('kept too');
    expect(map.features[0].confirmed).toMatchObject({ by: 'tester', at: '2026-09-18T20:00:00.000Z' });
    expect(Object.keys(map.features[0].confirmed.symbols)).toEqual(['src/math.js#alpha']);
    expect(map.features[1]).not.toHaveProperty('confirmed');
    expect(map.features[1]).toEqual(MAP.features[1]);
  });

  it('status after an edit names the changed symbol', async () => {
    runFeaturesCmd(['confirm', '--all', '--by', 'tester', '--repo', repoRoot], io());
    await writeFile(join(repoRoot, 'src', 'math.js'), 'export function alpha(x) {\n  return x + 2;\n}\n');
    out = [];
    expect(runFeaturesCmd(['status', '--repo', repoRoot], io())).toBe(0);
    expect(out[0]).toBe('2 features: 2 changed since confirmed, 0 unchanged, 0 never confirmed');
    expect(out.join('\n')).toContain('  changed: src/math.js#alpha');
  });

  it('an unknown id refuses and writes nothing, even when other ids are valid', async () => {
    const before = await readFile(mapPath(), 'utf8');
    expect(runFeaturesCmd(['confirm', 'math', 'nope', '--by', 'tester', '--repo', repoRoot], io())).toBe(2);
    expect(err.join('\n')).toMatch(/unknown feature id\(s\): nope; nothing written/u);
    expect(await readFile(mapPath(), 'utf8')).toBe(before);
  });

  it('confirm without --by refuses and writes nothing', async () => {
    const before = await readFile(mapPath(), 'utf8');
    expect(runFeaturesCmd(['confirm', '--all', '--repo', repoRoot], io())).toBe(2);
    expect(err.join('\n')).toMatch(/needs --by/u);
    expect(await readFile(mapPath(), 'utf8')).toBe(before);
  });
});
