import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { buildChangePlan, buildChangePlanWithContext } from '../../../mcp/stdio/query/verbs/change_plan.js';
import { buildOnboard } from '../../../mcp/stdio/query/verbs/onboard.js';

describe('composite verbs', () => {
  let dir;
  let db;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'apg-composite-'));
    db = openDb(join(dir, 'graph.sqlite'));

    const nodes = [
      { id: 'doc:readme', type: 'Document', label: 'README.md', file_path: 'README.md', start_line: 1, end_line: 3, language: '', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: {} },
      { id: 'file:main', type: 'File', label: 'main.py', file_path: 'src/main.py', start_line: 1, end_line: 8, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: {} },
      { id: 'file:auth', type: 'File', label: 'auth.py', file_path: 'src/auth.py', start_line: 1, end_line: 12, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: {} },
      { id: 'file:test', type: 'File', label: 'test_auth.py', file_path: 'tests/test_auth.py', start_line: 1, end_line: 8, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: {} },
      { id: 'entry:handle', type: 'Entrypoint', label: 'handle_request', file_path: 'src/main.py', start_line: 4, end_line: 7, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: { qname: 'src.main.handle_request' } },
      { id: 'class:auth', type: 'Class', label: 'AuthService', file_path: 'src/auth.py', start_line: 1, end_line: 12, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: { qname: 'src.auth.AuthService' } },
      { id: 'method:auth', type: 'Method', label: 'authenticate', file_path: 'src/auth.py', start_line: 5, end_line: 11, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: { qname: 'src.auth.AuthService.authenticate', parent_class: 'AuthService' } },
      { id: 'fn:db', type: 'Function', label: 'find_token', file_path: 'src/db.py', start_line: 1, end_line: 4, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: { qname: 'src.db.find_token' } },
      { id: 'test:auth', type: 'Test', label: 'test_authenticate_valid', file_path: 'tests/test_auth.py', start_line: 3, end_line: 6, language: 'python', confidence: 1, structural_fp: 's', dependency_fp: 'd', extra: { qname: 'tests.test_auth.test_authenticate_valid' } },
    ];

    nodes.forEach((node) => upsertNode(db, node));

    const edges = [
      { from_id: 'class:auth', to_id: 'method:auth', relation: 'CONTAINS', source_file: 'src/auth.py', source_line: 5, confidence: 1, extractor: 'python' },
      { from_id: 'entry:handle', to_id: 'method:auth', relation: 'CALLS', source_file: 'src/main.py', source_line: 5, confidence: 1, extractor: 'python' },
      { from_id: 'method:auth', to_id: 'fn:db', relation: 'CALLS', source_file: 'src/auth.py', source_line: 6, confidence: 1, extractor: 'python' },
      { from_id: 'test:auth', to_id: 'method:auth', relation: 'TESTS', source_file: 'tests/test_auth.py', source_line: 4, confidence: 1, extractor: 'python' },
    ];

    edges.forEach((edge) => upsertEdge(db, edge));
  });

  afterEach(async () => {
    db.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('buildChangePlan produces a rolled-up read order for classes', () => {
    const out = buildChangePlan(db, { symbol: 'AuthService', top_k: 5, dirtyCount: 0 });

    expect(out).toContain('CHANGE_PLAN AuthService class src/auth.py:1');
    expect(out).toContain('ROLLUP Class "AuthService" across 1 method');
    expect(out).toContain('TRUST STRONG');
    expect(out).toContain('READ ORDER');
    expect(out).toContain('1. src/auth.py — target definition');
    expect(out).toContain('src/main.py — top caller file');
    expect(out).toContain('tests/test_auth.py — test anchor');
    expect(out).toContain('AFFECTED FILES');
  });

  it('buildChangePlanWithContext surfaces map quality and dirty seam hints', () => {
    const out = buildChangePlanWithContext(db, {
      symbol: 'AuthService',
      top_k: 5,
      dirtyCount: 0,
      features: [{ id: 'auth', anchors: { files: ['src/auth.py'] } }],
      dirtyFiles: ['src/auth.py'],
      overlayQuality: {
        featureCount: 1,
        featuresWithTests: 0,
        featuresWithDocs: 0,
        featuresWithDependsOn: 0,
        featuresWithRelatedTo: 0,
        tasksTotal: 2,
        linkedTasks: 1,
      },
    });

    expect(out).toContain('MAP QUALITY tests 0/1');
    expect(out).toContain('linked tasks 1/2');
    expect(out).toContain('DIRTY SEAM');
    expect(out).toContain('target dirty: src/auth.py');
    expect(out).toContain('feature seam: auth(1)');
  });

  it('buildOnboard summarizes a scoped area with a start-here sequence', () => {
    const out = buildOnboard(db, { path: 'src', top_k: 5, dirtyCount: 0 });

    expect(out).toContain('ONBOARD src');
    expect(out).toContain('SCOPE 2 file(s)');
    expect(out).toContain('ENTRY POINTS');
    expect(out).toContain('handle_request entrypoint src/main.py:4');
    expect(out).toContain('KEY FILES');
    expect(out).toContain('HUB SYMBOLS');
    expect(out).toContain('START HERE');
    expect(out).toContain('src/main.py');
    expect(out).toContain('src/auth.py');
  });
});
