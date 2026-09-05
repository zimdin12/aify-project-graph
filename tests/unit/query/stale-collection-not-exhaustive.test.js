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
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

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
      id: 'col-1', root: '/x', fv: 'hash-A', hash: over.dbHash ?? 'hash-A',
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

  // ⛔⛔ AN UNKNOWN HEAD IS NOT A CURRENT ONE, AND THIS MODULE ALREADY KNOWS THAT.
  //
  // Found by the fail-open sweep (R1c), which flagged `let stale = false; try { ... } catch { }` in
  // lsp-evidence.js. The probe does not even have to throw: `getHeadCommit(repoRoot).catch(() =>
  // null)` swallows a failure to `null` itself, and the guard is `if (head && collection.
  // indexedCommit && head !== collection.indexedCommit)`. So when HEAD cannot be read, `stale` stays
  // FALSE, no downgrade branch fires, and the collection earns
  // `TRUST: lsp-verified (… index-ready, N callers …)` — the exact wording the server-instructions
  // say licenses "safe to delete", over a collection whose currency could not be established.
  //
  // ⚠ THE ASYMMETRY IS THE POINT, and it sits FORTY LINES BELOW in the same function. The telemetry
  // unknown is handled fail-closed and argued in a comment: "A missing measurement is not a good
  // measurement — treating absent telemetry as '0% unresolved' would grant the exhaustive banner on
  // exactly the collections we know least about." That is this case, word for word, and the
  // staleness unknown gets the opposite treatment silently.
  //
  // ⇒ This is the sand_castle incident in the header arriving through a different door: there the
  // staleness was KNOWN and appended too late; here it is UNKNOWN and reads as current.
  it('★★★ a collection whose currency CANNOT be established does not earn the exhaustive banner', async () => {
    const head = await commitAll(repoRoot, 'one');

    const db = openDb(dbPath);
    insertCollection(db, { commit: head, found: 100, notFound: 0 });
    // Make HEAD unreadable the way a real repo does — the git directory is gone, so `rev-parse`
    // fails and the collection's currency is genuinely unknowable. Not a stubbed throw: the
    // production path swallows to null on its own, and stubbing would test the stub.
    await rm(join(repoRoot, '.git'), { recursive: true, force: true });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    // ⛔ THE RATCHET CAUGHT THIS AS A BARE not.toMatch — the third time this session, and every time
    // only the mechanical guard noticed. A negative assertion whose matcher was never watched fire
    // is a silence that means nothing; the canaries make it mean something.
    expectAbsentWithLiveMatcher(
      /index-ready, \d+ caller/,
      {
        forbidden: 'TRUST: lsp-verified (cpp-clangd, index-ready, 1 caller, compile-db hash-A)',
        allowed: 'TRUST: lsp-partial (clangd verified 1 caller, but whether this collection is still current could NOT be established)',
      },
      line,
      'an unverifiable currency must not read as a verified one',
    );
    expect(line, 'and the reader must be told to treat the set as a floor').toMatch(/FLOOR/);
  });

  it('★★ POSITIVE CONTROL: the same fixture WITH a readable HEAD still earns it', async () => {
    // ⛔ Without this, a fix that downgraded every banner would satisfy the test above while
    // destroying the attestation entirely. This repo has shipped a guard of exactly that shape
    // before — one that fired correctly and also deleted real edges.
    const head = await commitAll(repoRoot, 'one');

    const db = openDb(dbPath);
    insertCollection(db, { commit: head, found: 100, notFound: 0 });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    expect(line, 'a collection proven current keeps the exhaustive wording')
      .toMatch(/index-ready, 1 caller/);
  });

  // ⛔⛔ ONE BOOLEAN, TWO CAUSES, ONE HARD-CODED MESSAGE — AND THE MESSAGE IS FALSE FOR ONE OF THEM.
  //
  // `stale` is set from two places: the HEAD comparison, and the compile-DB hash comparison. Both
  // render the single sentence "the collection is STALE — indexed <sha>, HEAD has moved." When only
  // the compile DB changed, HEAD has NOT moved, and the banner prints the collection's commit while
  // claiming it moved — a self-contradicting FALSE statement, in one line, on the surface whose
  // whole product is honesty.
  //
  // Reproduced before this test was written:
  //     HEAD (actual)            8af5aaa
  //     collection.indexedCommit 8af5aaa   <- IDENTICAL
  //     emitted                  "... STALE — indexed 8af5aaa, HEAD has moved ..."
  //
  // ⚠ FOUND BY CHECKING A REVIEWER'S CLAIM RATHER THAN ADOPTING IT. They argued `stale` was a
  // boolean carrying three states, and that `stale=true` "declines to certify" rather than
  // asserting. The conclusion was right and that supporting clause was not — as rendered it DOES
  // assert — and the gap between the two is where this defect was sitting.
  it('★★★ a compile-DB change must not be reported as HEAD moving', async () => {
    const head = await commitAll(repoRoot, 'one');
    // A real compile DB on disk, so prepareCompileDb finds one and hashes it. The collection stores
    // a DIFFERENT hash, so the DB-change branch fires while HEAD is untouched.
    await writeFile(join(repoRoot, 'compile_commands.json'), JSON.stringify([
      { directory: repoRoot, file: join(repoRoot, 'a.cpp'), command: 'clang++ -c a.cpp' },
    ]));

    const db = openDb(dbPath);
    insertCollection(db, { commit: head, found: 100, notFound: 0, dbHash: 'STALE-DB-HASH' });
    const line = await buildTrustLine({ edges: [verifiedEdge], db, repoRoot });
    db.close();

    // The GRANT is unchanged and must stay unchanged: a changed compile DB still means the evidence
    // describes a different index, so the set is a floor.
    expect(line, 'a changed compile DB still withholds the exhaustive banner').toMatch(/FLOOR/);
    // What must change is the CAUSE. HEAD did not move.
    expectAbsentWithLiveMatcher(
      /HEAD has moved/,
      {
        forbidden: 'the collection is STALE — indexed 8af5aaa, HEAD has moved.',
        allowed: 'the collection is STALE — the compile DB has changed since it was collected.',
      },
      line,
      'HEAD did not move; saying so is a false statement in the trust banner',
    );
    expect(line, 'and the real cause is named instead').toMatch(/compile DB/i);
  }, 30_000);

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
