import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCodeIntelJsonl, validateCodeIntelRecord } from '../../../../mcp/stdio/ingest/code-intel/schema.js';

describe('code-intel schema', () => {
  it('normalizes symbol records into APG node-ready facts', () => {
    const record = validateCodeIntelRecord({
      kind: 'symbol',
      symbol_kind: 'method',
      qname: 'ChunkManager::setVoxel',
      file: 'engine/voxel/ChunkManager.cpp',
      range: { start: { line: 42 }, end: { line: 51 } },
      language: 'cpp',
    });

    expect(record).toMatchObject({
      kind: 'symbol',
      qname: 'ChunkManager::setVoxel',
      name: 'setVoxel',
      node_type: 'Method',
      file: 'engine/voxel/ChunkManager.cpp',
      start_line: 42,
      end_line: 51,
      language: 'cpp',
    });
  });

  it('normalizes call records into relation facts', () => {
    const record = validateCodeIntelRecord({
      kind: 'call',
      source: { qname: 'A::run', file: 'src/A.cpp', line: 10 },
      target: { qname: 'B::step', file: 'src/B.cpp', line: 4 },
      file: 'src/A.cpp',
      start_line: 12,
    });

    expect(record.relation).toBe('CALLS');
    expect(record.source.qname).toBe('A::run');
    expect(record.target.qname).toBe('B::step');
  });

  it('reports JSONL line numbers for invalid records', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'apg-ci-schema-'));
    try {
      const path = join(dir, 'records.jsonl');
      await writeFile(path, [
        JSON.stringify({ kind: 'symbol', qname: 'ok', file: 'ok.cpp' }),
        JSON.stringify({ kind: 'symbol', qname: 'bad' }),
      ].join('\n'));

      await expect(readCodeIntelJsonl(path)).rejects.toMatchObject({
        errors: [expect.objectContaining({ line: 2 })],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
