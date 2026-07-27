// P0-5 / P0-3 (2026-07-26) — a STALE or heavily-unresolved collection must never
// emit the banner that licenses "safe to delete".
//
// The "index-ready, N callers" wording is the one our server-instructions say
// grants an EXHAUSTIVE caller set. Staleness used to be appended as
// " — STALE, re-collect" AFTER that wording had already been chosen, so Sand
// Castle saw an exhaustive-shaped attestation over a collection 5 weeks and 100+
// commits behind HEAD. Staleness is now decided BEFORE the wording.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { buildTrustLine } from '../../../mcp/stdio/query/lsp-evidence.js';

const verifiedEdge = { provenance: 'LSP_VERIFIED', extractor: 'cpp-clangd#deadbeef' };

function initGitRepo(root) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', 'test@test');
  git('config', 'user.name', 'test');
}

async function commitAll(root, msg) {
  await writeFile(join(root, `${msg}.txt`), msg);
  execFileSync('git', ['-C', root, 'add', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'commit', '-m', msg], { stdio: 'ignore' });
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function insertCollection(db, over = {}) {
  db.run(
    `INSERT INTO code_intel_collections
       (collection_id, provider, provider_version, project_root, language, status,
        freshness_basis, freshness_value, compile_db_hash, indexed_commit,
        operations_json, collected_at)
     VALUES ($id, 'cpp-clangd', '0.1.0', $root, 'cpp', 'ok',
        'compile_db_hash', $fv, $hash, $commit, $ops, '2026-06-19T01:02:14.438Z')`,
    {
      id: 'col-1', root: '/x', fv: 'hash-A', hash: 'hash-A',
      commit: over.commit ?? 'aaaaaaaaaaaa',
      ops: JSON.stringify({
        references: { status: 'ok', count: 10 },
        _session: { indexReady: true, refsFoundSymbols: over.found ?? 6643, refsNotFoundSymbols: over.notFound ?? 0 },
      }),
    },
  );
}

describe('stale / unresolved collections cannot license exhaustiveness', () => {
  let repoRoot;
  let dbPath;

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-staletrust-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    dbPath = join(repoRoot, '.aify-graph', 'graph.sqlite');
    initGitRepo(repoRoot);
  });
  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('a collection whose indexed commit is behind HEAD reports lsp-partial, not exhaustive', async () => {
    const first = await commitAll(repoRoot, 'one');
    await commitAll(repoRoot, 'two'); // HEAD moves past the collection

    const db = openDb(dbPath);
    insertCollection(db, { commit: first });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    expect(line).toMatch(/lsp-partial/);
    expect(line).toMatch(/STALE/i);
    expect(line).toMatch(/FLOOR/);
    // Must NOT carry the exhaustive-licensing wording.
    expect(line).not.toMatch(/index-ready, \d+ caller/);
  });

  it('a fresh, fully-resolved collection still earns the exhaustive attestation', async () => {
    const head = await commitAll(repoRoot, 'one');

    const db = openDb(dbPath);
    insertCollection(db, { commit: head, found: 100, notFound: 0 });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    expect(line).toMatch(/index-ready, 1 caller/);
    expect(line).not.toMatch(/STALE/i);
  });

  it('a capped edge fetch cannot claim a complete caller set', async () => {
    const head = await commitAll(repoRoot, 'one');
    const db = openDb(dbPath);
    insertCollection(db, { commit: head, found: 100, notFound: 0 });
    // Same inputs that would otherwise earn "index-ready, N callers" — only the
    // truncation flag differs, and it must be enough to withdraw the claim.
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot, truncated: true });
    db.close();

    expect(line).toMatch(/lsp-partial/);
    expect(line).toMatch(/FLOOR/);
    expect(line).toMatch(/cap/);
    expect(line).not.toMatch(/index-ready, \d+ caller/);
  });

  it('a collection that left many symbols unresolved reports lsp-partial with the ratio', async () => {
    const head = await commitAll(repoRoot, 'one');

    const db = openDb(dbPath);
    // The sand_castle shape: 2274 unresolved of 8917 (~25%).
    insertCollection(db, { commit: head, found: 6643, notFound: 2274 });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    expect(line).toMatch(/lsp-partial/);
    expect(line).toMatch(/2274 of 8917/);
    expect(line).toMatch(/26%/); // 2274/8917 = 25.5% → 26%
    expect(line).not.toMatch(/index-ready, \d+ caller/);
  });
});
