import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb, openExistingDb } from '../../../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../../../mcp/stdio/ingest/code-intel/importer.js';
import { buildVerifyPacket } from '../../../mcp/stdio/query/verbs/packet-verify.js';

function setupRepo({ fixture, stale = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-vfy-'));
  const graphDir = path.join(dir, '.aify-graph');
  mkdirSync(graphDir, { recursive: true });
  const dbPath = path.join(graphDir, 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  if (fixture) {
    const tmp = path.join(os.tmpdir(), `apg-vfy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    let content = fs.readFileSync(`tests/fixtures/code-intel/v02/${fixture}`, 'utf8');
    const obj = JSON.parse(content);
    if (stale) {
      obj.session.collectedAt = '2025-01-01T00:00:00Z';
    } else {
      obj.session.collectedAt = new Date().toISOString();
    }
    content = JSON.stringify(obj);
    fs.writeFileSync(tmp, content);
    const db2 = openExistingDb(dbPath, { readonly: false });
    importCodeIntel(tmp, db2);
    db2.close();
  }
  return dir;
}

describe('verify mode (W1.4 fixtures)', () => {
  it('(a) clean edit + fresh provider — returns ok packet with diagnostics block', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.mode).toBe('verify');
    expect(packet.evidence.available).toBe(true);
    expect(packet.evidence.status).toBe('ok');
    expect(packet.diagnostics.length).toBe(1);
    expect(packet.stale).toBe(false);
    expect(packet.partial).toBe(false);
  });

  it('(b) edit + stale provider — surfaces stale=true', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json', stale: true });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.available).toBe(true);
    expect(packet.stale).toBe(true);
  });

  it('(c) edit + provider unavailable — explicit unavailable + tree-sitter-only output', () => {
    const dir = setupRepo();
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.available).toBe(false);
    expect(packet.rendered).toMatch(/code_intel unavailable/);
    expect(packet.rendered).toMatch(/tree-sitter\+overlay only/);
  });

  it('(d) edit touching audited code — surfaces SOURCE_REQUIRED', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'], audited: true });
    expect(packet.sourceRequired).toBe(true);
    expect(packet.rendered).toMatch(/SOURCE_REQUIRED/);
  });

  it('(e) edit + partial provider state — renders partial status distinctly', () => {
    const dir = setupRepo({ fixture: 'cpp-partial-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/bar.cpp'] });
    expect(packet.evidence.status).toBe('partial');
    expect(packet.partial).toBe(true);
    expect(packet.rendered).toMatch(/CODE_INTEL partial/);
    expect(packet.rendered).toMatch(/references/);
  });

  it('exercises files[] with an untracked file (pre-clean-ref)', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({ repoRoot: dir, files: ['src/new_untracked.cpp'] });
    expect(packet.diagnostics.length).toBe(0);
    expect(packet.evidence.available).toBe(true);
    expect(packet.rendered).toMatch(/src\/new_untracked.cpp/);
  });

  it('renders bounded analyzer evidence when supplied', () => {
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const packet = buildVerifyPacket({
      repoRoot: dir,
      files: ['src/bar.cpp'],
      analysis: {
        status: 'ok',
        mode: 'compile',
        summary: { diagnostics: 1, errors: 1, warnings: 0 },
        diagnostics: [{
          file: 'src/bar.cpp',
          line: 3,
          col: 12,
          severity: 'error',
          message: 'bad thing',
          provenance: 'BUILD'
        }]
      }
    });
    expect(packet.rendered).toMatch(/ANALYZER \(compile\): 1 diagnostics, 1 errors, 0 warnings/);
    expect(packet.rendered).toMatch(/src\/bar\.cpp:3:12 \[BUILD\] bad thing/);
  });
});

describe('graphPacket(mode:verify)', () => {
  it('routes verify mode through buildVerifyPacket', async () => {
    const { graphPacket } = await import('../../../mcp/stdio/query/verbs/packet.js');
    const dir = setupRepo({ fixture: 'cpp-bar-diagnostic-collection.json' });
    const out = await graphPacket({ repoRoot: dir, mode: 'verify', files: ['src/bar.cpp'] });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/MODE: verify/);
    expect(out).toMatch(/DIAGNOSTICS/);
  });

  it('verify mode without files still returns a packet', async () => {
    const { graphPacket } = await import('../../../mcp/stdio/query/verbs/packet.js');
    const dir = setupRepo();
    const out = await graphPacket({ repoRoot: dir, mode: 'verify' });
    expect(typeof out).toBe('string');
    expect(out).toMatch(/MODE: verify/);
  });
});
