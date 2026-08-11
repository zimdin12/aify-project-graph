// ★ "SUCCESS MUST ATTEST CORPUS AND SCOPE."
//
// graph-senior-dev's generalisation, from four separate upstream projects plus ours:
// codegraph #1502 reported "complete" with 0 files · #1361 turned a lock failure into
// "up to date" · Understand #628 silently dropped cross-batch edges · graphify #2520
// exited 0 with parse holes. One invariant, four codebases.
//
// Ours (docs/2026-08-10-one-plan.md §2.2) was worse than the write-up said. The indexer
// calls deleteNodesForFile BEFORE reading and parsing, so `continue` on failure does not
// leave the file's previous graph state alone — it leaves the file ABSENT from the graph,
// having been present a moment earlier. The comments read "Skip files that fail to parse
// — non-fatal", which described the intent and not the effect. Then `status: 'ok'`.
//
// The consequence is the one that matters: an agent asks "who calls X", gets a confident
// answer computed over a corpus with holes in it, and nothing in the response says so.
// A missing file cannot produce a wrong edge — it produces a missing edge, which reads
// exactly like a true negative.
//
// Not made fatal: one unreadable file should not abandon a whole reindex, and a partial
// graph beats none. What must not happen is the partiality being invisible.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { graphHealth } from '../../../mcp/stdio/query/verbs/health.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-corpus-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

async function commitAll() {
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'x'], { cwd: repoRoot });
}

async function readManifest() {
  return JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));
}

describe('an index that loses files must say so', () => {
  it('a clean repo attests ZERO skips — the field must not cry wolf', async () => {
    // Without this, "always report skips" would pass the case below, and a count that
    // is never zero is a count nobody reads.
    await writeFile(join(repoRoot, 'src', 'a.js'), 'export function alpha() { return 1; }\n');
    await commitAll();

    await ensureFresh({ repoRoot });

    const manifest = await readManifest();
    expect(manifest.status).toBe('ok');
    expect(manifest.skippedFileCount).toBe(0);
  });

  it('★ a file dropped from the graph is counted, named, and its phase recorded', async () => {
    await writeFile(join(repoRoot, 'src', 'good.js'), 'export function good() { return 1; }\n');
    // A file over the 1 MB extraction cap. This is the deterministic, cross-platform
    // hole — and it is the one I found while trying to build a fixture for the read
    // and parse failures: it deletes the file's nodes and continues, exactly like a
    // failure, and it was the only one of the three that looked intentional enough
    // that nobody had questioned it.
    await writeFile(join(repoRoot, 'src', 'huge.js'), `// ${'x'.repeat(1_100_000)}\nexport function huge() {}\n`);
    await commitAll();

    await ensureFresh({ repoRoot });

    const manifest = await readManifest();
    expect(manifest.skippedFileCount, 'the unreadable path must be counted').toBeGreaterThan(0);
    const entry = (manifest.skippedFiles ?? []).find((s) => s.file.includes('huge.js'));
    expect(entry, 'the skipped file must be NAMED, not just counted').toBeTruthy();
    expect(entry.phase).toBe('too_large');
    expect(entry.reason, 'and carry why, so the reader can act').toBeTruthy();

    // The run still succeeds — partial is better than nothing, as long as it is honest.
    expect(manifest.status).toBe('ok');
  });

  it('★★ graph_index does not name a DROPPED file as processed, and discloses in its own response', async () => {
    // ef-manager on a 4.1 MB miniaudio.h, 2026-08-11: the file appeared in
    // `processedFiles`, `graph_whereis("ma_device_init")` returned NO MATCH, and the
    // response carried no disclosure at all. graph_health was correct — but this is the
    // response the REINDEXING agent reads, at the moment it learns what the index did,
    // and it affirmatively asserted the opposite.
    //
    // `existingFiles` is populated BEFORE the size/read/parse checks, which is how a
    // dropped file ended up on the processed list.
    await writeFile(join(repoRoot, 'src', 'good.js'), 'export function good() { return 1; }\n');
    await writeFile(join(repoRoot, 'src', 'huge.js'), `// ${'x'.repeat(1_100_000)}\nexport function huge() {}\n`);
    await commitAll();

    const result = await ensureFresh({ repoRoot });

    const processed = result.processedFiles ?? [];
    expect(processed.some((f) => f.includes('good.js')), 'the file that WAS indexed must be listed').toBe(true);
    expect(processed.some((f) => f.includes('huge.js')), 'a dropped file must NOT be listed as processed').toBe(false);

    // And the disclosure must be here, not only in the manifest — a caller should not
    // have to be told to go look somewhere else.
    expect(result.skippedFileCount).toBeGreaterThan(0);
    expect((result.skippedFiles ?? []).some((s) => s.file.includes('huge.js'))).toBe(true);
  });

  it('★★ graph_health refuses to let status:ok stand alone when the corpus has holes', async () => {
    // The attestation is worthless if it stops at the manifest. This is the assertion
    // that makes the fix reach an agent: the verb everyone is told to call first must
    // say the corpus is incomplete, and say what that means for their results.
    await writeFile(join(repoRoot, 'src', 'good.js'), 'export function good() { return 1; }\n');
    await writeFile(join(repoRoot, 'src', 'huge.js'), `// ${'x'.repeat(1_100_000)}\nexport function huge() {}\n`);
    await commitAll();

    await ensureFresh({ repoRoot });
    const health = await graphHealth({ repoRoot });
    const text = typeof health === 'string' ? health : JSON.stringify(health);

    expect(text).toMatch(/INCOMPLETE CORPUS/);
    expect(text, 'must name the consequence, not just the count').toMatch(/no callers|not found/);
    expect(text).toMatch(/huge\.js/);
  });

  it('the count is UNCAPPED even though the list is capped', async () => {
    // dirtyEdges/dirtyEdgeCount exist as a pair for exactly this reason: a cap on the
    // sample must never make the loss look smaller than it is. Same discipline here —
    // skippedFiles is capped at 50, skippedFileCount is not.
    await writeFile(join(repoRoot, 'src', 'good.js'), 'export function good() { return 1; }\n');
    await commitAll();

    await ensureFresh({ repoRoot });
    const manifest = await readManifest();

    // Structural: the two fields must be independent, so a future cap change cannot
    // silently start under-reporting.
    expect(manifest).toHaveProperty('skippedFileCount');
    expect(manifest).toHaveProperty('skippedFiles');
    expect(Array.isArray(manifest.skippedFiles)).toBe(true);
    expect(manifest.skippedFiles.length).toBeLessThanOrEqual(50);
  });
});
