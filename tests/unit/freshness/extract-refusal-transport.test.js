// ⛔ A TYPED REFUSAL WHOSE TYPE DIES AT THE BOUNDARY IS NOT A TYPED CONTRACT.
//
// `extractFile` throws `APG_DUPLICATE_SYMBOL_SITE` when an undeclared duplicate symbol site would
// otherwise be merged silently. I first asserted that code AT THE THROW SITE and reported the
// contract as end-to-end. Review read the consumer: the orchestrator caught every extraction error
// and persisted only `{phase:'parse', reason: err.message}`, dropping `err.code`. The claim was
// true where I measured it and false where it mattered — an extractor DEFECT and an ordinary
// syntax error in a vendored file reached the reader as the same line.
//
// ⚠ MY SECOND ATTEMPT WAS ALSO REJECTED, AND RIGHTLY. It pinned a COPY of the rendering rule and
// asserted the shipped source still contained it. Source text is not behaviour, and a copied rule
// tests itself. Review's ruling: neither export a helper just to make it testable — that
// recreates the helper-without-consumer defect one level lower — nor accept source parity. Use the
// real end-to-end seam that already exists.
//
// So this runs the actual producer (`ensureFresh` with a forced typed throw) and the actual
// consumer (`graphHealth`), and reads back the manifest and the response.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Forced BEFORE the orchestrator imports it. With auto-repair removed there is no natural source
// where two symbols share a declarator span — measured zero across 782 tracked files — so a branch
// that correctly never fires on real input can only be exercised by forcing it.
vi.mock('../../../mcp/stdio/ingest/extractors/generic.js', () => ({
  extractFile: () => {
    const err = new Error('undeclared duplicate symbol site in src/dup.js: "alpha" at bytes 0-30');
    err.code = 'APG_DUPLICATE_SYMBOL_SITE';
    throw err;
  },
}));

const { ensureFresh } = await import('../../../mcp/stdio/freshness/orchestrator.js');
const { graphHealth } = await import('../../../mcp/stdio/query/verbs/health.js');

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-refusal-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repoRoot });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

async function seedAndIndex() {
  await writeFile(join(repoRoot, 'src', 'dup.js'), 'export function alpha() { return 1; }\n');
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'x'], { cwd: repoRoot });
  return ensureFresh({ repoRoot });
}

const readManifest = async () =>
  JSON.parse(await readFile(join(repoRoot, '.aify-graph', 'manifest.json'), 'utf8'));

describe('an extraction refusal keeps its type all the way to a reader', () => {
  it('⛔ the ensureFresh RESPONSE names the file and carries the code', async () => {
    const result = await seedAndIndex();
    const entry = (result.skippedFiles ?? []).find((s) => s.file.includes('dup.js'));
    expect(entry, 'the refused file must be attested in the response, not only the manifest').toBeTruthy();
    expect(entry.phase).toBe('extract');
    expect(entry.code).toBe('APG_DUPLICATE_SYMBOL_SITE');
    expect(result.skippedFileCount).toBeGreaterThan(0);
  });

  it('⛔ the MANIFEST persists the same typed record', async () => {
    await seedAndIndex();
    const manifest = await readManifest();
    const entry = (manifest.skippedFiles ?? []).find((s) => s.file.includes('dup.js'));
    expect(entry).toBeTruthy();
    expect(entry.code).toBe('APG_DUPLICATE_SYMBOL_SITE');
  });

  it('⛔ graph_health RENDERS the code, so an agent can tell a defect from a syntax error', async () => {
    // The authority-bearing path: the verb everyone is told to call first. Both a refusal and a
    // vendored syntax error are phase 'extract'; without the code they are one line to a reader.
    await seedAndIndex();
    const health = await graphHealth({ repoRoot });
    const text = typeof health === 'string' ? health : JSON.stringify(health);
    expect(text).toMatch(/INCOMPLETE CORPUS/);
    expect(text).toContain('APG_DUPLICATE_SYMBOL_SITE');
    expect(text).toMatch(/dup\.js/);
  });

  it('POSITIVE CONTROL: a legacy record with no code renders without printing "undefined"', async () => {
    // Manifests written before this change carry no `code`. A migration that breaks reading old
    // state is its own outage, and `(too_large: undefined)` would be a new lie in the output.
    await seedAndIndex();
    const manifestPath = join(repoRoot, '.aify-graph', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.skippedFiles = [{ file: 'src/legacy.js', phase: 'too_large' }];
    manifest.skippedFileCount = 1;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    const health = await graphHealth({ repoRoot });
    const text = typeof health === 'string' ? health : JSON.stringify(health);
    expect(text).toMatch(/legacy\.js/);
    expect(text, 'an absent code must render as nothing, never as the word undefined')
      .not.toContain('undefined');
  });
});
