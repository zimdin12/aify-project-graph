import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFeaturePacket } from '../../../mcp/stdio/query/verbs/packet-overlay.js';
import { confirmFeature } from '../../../mcp/stdio/overlay/confirmation.js';

const OPTS = { mode: 'orient', read_first: 3, contracts: 3, tests: 3, risks: 3 };
const FEATURE = { id: 'math', anchors: { symbols: ['alpha'], files: ['src/math.js'] } };

describe('feature packet: the CONFIRMED line', () => {
  let repoRoot;
  const body = (x) => `export function alpha(x) {\n  return x + ${x};\n}\n`;
  const line = (feature) => buildFeaturePacket({ feature, brief: null, functionality: null, opts: OPTS, snapshot: 'SNAPSHOT', repoRoot })
    .find((l) => l.startsWith('CONFIRMED:'));

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-packet-confirm-'));
    await mkdir(join(repoRoot, 'src'), { recursive: true });
    await writeFile(join(repoRoot, 'src', 'math.js'), body(1));
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('a never-confirmed feature says so and names the command that confirms it', () => {
    expect(line(FEATURE)).toBe('CONFIRMED: never — after checking the description against the code, run `apg features confirm <id> --by <you>`');
  });

  it('a confirmed feature whose anchored code changed says what changed and asks for a re-check', async () => {
    const feature = { ...FEATURE, confirmed: confirmFeature(repoRoot, FEATURE, { by: 'tester', at: '2026-09-18T20:00:00.000Z' }) };
    expect(line(feature)).toBe('CONFIRMED: 2026-09-18T20:00:00.000Z by tester; anchored symbols unchanged since');
    await writeFile(join(repoRoot, 'src', 'math.js'), body(2));
    expect(line(feature)).toBe('CONFIRMED: 2026-09-18T20:00:00.000Z by tester; CHANGED SINCE — re-check the description: changed src/math.js#alpha; changed src/math.js');
  });
});
