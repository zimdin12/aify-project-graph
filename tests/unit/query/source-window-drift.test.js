// ★ THE OFFSETS ARE FROM THE INDEX; THE BYTES ARE FROM NOW.
//
// `readSourceWindow` reads the CURRENT file at line offsets recorded when the graph was
// built. Insert or delete lines above a symbol and the window slides — so graph_explore
// serves a DIFFERENT symbol's body under a header naming the one that was asked for.
//
// That was the top unfixed finding in docs/2026-08-10-one-plan.md (§2.1), and its shape
// is the worst available here: every other stale-data path in this server degrades toward
// silence, and this one degrades toward a plausible lie — on the verb whose banner tells
// the reader "do NOT re-Read the files shown below", i.e. an instruction to stop checking.
//
// These tests run the renderer against real files on disk. They assert on EMITTED TEXT,
// not on source spelling — the 68-case audit of 2026-08-10 found that grep-tests would
// have passed here while the body was wrong.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderSourceBlock, manifestIndexedAtMs } from '../../../mcp/stdio/query/source-bundle.js';

let repoRoot;

// The file as the graph indexed it: `targetSymbol` genuinely occupies lines 1-3.
const AT_INDEX_TIME = [
  'void targetSymbol() {',
  '  doTheRightThing();',
  '}',
  '',
  'void otherSymbol() {',
  '  doSomethingElse();',
  '}',
].join('\n');

// The same file after four lines were inserted above it. `targetSymbol` now lives at
// 5-7, and lines 1-3 are a DIFFERENT function. The graph still says 1-3.
const AFTER_EDIT = [
  'void insertedFirst() {',
  '  brandNewBehaviour();',
  '}',
  '',
  'void targetSymbol() {',
  '  doTheRightThing();',
  '}',
  '',
  'void otherSymbol() {',
  '  doSomethingElse();',
  '}',
].join('\n');

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-drift-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  await mkdir(join(repoRoot, 'src'), { recursive: true });
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

async function writeManifest(indexedAt) {
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({ indexedAt }));
}

describe('source window verification — the offsets are from the index, the bytes are from now', () => {
  it('★ PROVEN DRIFT: a symbol absent from its own body is called out as the WRONG body', async () => {
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AFTER_EDIT);

    // The graph's offsets: targetSymbol @ 1-3. True when indexed, false now.
    const { text } = renderSourceBlock({
      symbol: 'targetSymbol',
      filePath: 'src/target.cpp',
      startLine: 1,
      endLine: 3,
      repoRoot,
      perBlockLines: 50,
    });

    // The window really does contain the other function — this is the bug reproducing.
    expect(text).toContain('insertedFirst');
    expect(text).not.toContain('doTheRightThing');

    // ...and it must SAY SO. Before the fix this block rendered clean.
    expect(text).toMatch(/WRONG BODY/);
    expect(text, 'the warning must name the symbol the caller asked for').toContain('targetSymbol');
    expect(text).toMatch(/graph_index/);
  });

  it('★ the warning is ABOVE the source, not below it', async () => {
    // A reader who scans the body and stops has already been misled. A caveat under
    // forty lines of plausible C++ is decoration.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AFTER_EDIT);

    const { text } = renderSourceBlock({
      symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50,
    });

    // ⚠ The presence assertion is NOT redundant. Without it this case passes when the
    // warning is absent entirely, because indexOf returns -1 and -1 < any real index.
    // Caught by running the suite with the check disabled — the ordering test was the
    // one case that stayed green while the defect was live, which is the whole failure
    // mode of the 68 source-grep cases arriving in a test written to replace them.
    expect(text).toMatch(/WRONG BODY/);
    expect(text.indexOf('WRONG BODY')).toBeLessThan(text.indexOf('insertedFirst'));
  });

  it('a correct window is NOT warned about — the check must not cry wolf', async () => {
    // Without this, "warn on everything" would pass the cases above, and a banner that
    // always fires is one nobody reads. Same argument that killed the filler suggestion.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AT_INDEX_TIME);
    await writeManifest(new Date(Date.now() + 60_000).toISOString());

    const { text, warnings } = renderSourceBlock({
      symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50, indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    expect(text).toContain('doTheRightThing');
    expect(warnings).toEqual([]);
    expect(text).not.toMatch(/WRONG BODY|NOT Read-equivalent/);
  });

  it('★ STALENESS fires independently: file modified after indexing, offsets still land', async () => {
    // The second check exists because the first can false-negative. Here the window
    // still contains the symbol name, so drift-proof stays silent — but the file was
    // edited after the index, so the line numbers are unverified. A rename elsewhere
    // could have slid this window onto a same-named overload.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AT_INDEX_TIME);
    await writeManifest(new Date(Date.now() - 60_000).toISOString());
    // Modified one minute AFTER the recorded index time.
    const after = new Date(Date.now() + 60_000);
    await utimes(file, after, after);

    const { text, warnings } = renderSourceBlock({
      symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50, indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    expect(warnings.map((w) => w.kind)).toContain('modified_since_index');
    expect(text).toMatch(/UNVERIFIED BODY/);
    // A DIFFERENT claim, not a weaker one. `WRONG BODY` asserts the served lines are
    // provably not the symbol; `UNVERIFIED BODY` asserts we cannot tell — which
    // the field test's decoy test showed is the more dangerous of the two, because the
    // undetectable case is the one that reads as correct.
    expect(text).not.toMatch(/WRONG BODY/);
  });

  it('★★ BOTH kinds on one block counts as ONE unverified block, not two', async () => {
    // the field test, on a real C++ repo: "NOT Read-equivalent for 2 of 1 block(s)".
    // `unverified` counted WARNINGS while `blocks` counted BLOCKS.
    //
    // ★ MY FIXTURES MADE THIS UNREACHABLE, which is the more important half. The drift
    // cases above synthesise staleness by writing a file and passing old line numbers,
    // with no manifest — so exactly one warning fires and the two kinds never co-occur.
    // In production they ALWAYS co-occur: a real edit changes content and mtime
    // together. The suite asserted the production-impossible case and never saw the
    // guaranteed one.
    const { renderSourceBundle } = await import('../../../mcp/stdio/query/source-bundle.js');
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AFTER_EDIT);
    await writeManifest(new Date(Date.now() - 60_000).toISOString());
    const after = new Date(Date.now() + 60_000);
    await utimes(file, after, after);

    const { unverified } = renderSourceBundle({
      blocks: [{ symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3 }],
      repoRoot,
      indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    expect(unverified, 'ONE block is unverified, however many ways it is unverified').toHaveLength(1);
    expect(unverified[0].kinds.sort()).toEqual(['modified_since_index', 'offset_drift']);
  });

  it('★ the staleness warning names FABRICATION, not a numbering slip', async () => {
    // the field test's adversarial case: 200 decoy lines crafted so the stale window still
    // opens with the correct signature and closes with a brace, defeating the drift
    // proof by construction. The served body was entirely fabricated and the reader was
    // told only that "line numbers may not be the lines these symbols now occupy".
    //
    // The severities were ordered by DETECTABILITY, not by HARM: the loud ⛔ fired when
    // the body was obviously wrong, the soft ⚠ when it was convincingly wrong.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AT_INDEX_TIME);
    await writeManifest(new Date(Date.now() - 60_000).toISOString());
    const after = new Date(Date.now() + 60_000);
    await utimes(file, after, after);

    const { text } = renderSourceBlock({
      symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50, indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    // Must say the CONTENT may be another function, not that the numbering is off.
    expect(text).toMatch(/DIFFERENT function/);
    expect(text, 'and must say what the passing name-check does NOT rule out').toMatch(/rules out only the obvious case/);
    expect(text, 'a fabricated body is not a soft warning').toMatch(/⛔/);
  });

  it('★★ a FILE block is never drift-proved — a file need not contain its own name', async () => {
    // the reviewer reproduced this live on a FRESH index: `graphExplore({symbols:
    // ['bin/apg.js']})` reported PROVEN OFFSET DRIFT, because file targets resolve to
    // File nodes whose `label` is the filename, and that filename was passed as the
    // symbol to look for. A source file need not mention its own name anywhere.
    //
    // A false ⛔ on a correct repo is the worst outcome available for this check. A
    // warning that fires when nothing is wrong trains readers to ignore it, which costs
    // more than never having built it.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AT_INDEX_TIME);

    const { text, warnings } = renderSourceBlock({
      symbol: 'target.cpp',          // a File node's label
      filePath: 'src/target.cpp',
      startLine: 1,
      endLine: 3,
      repoRoot,
      perBlockLines: 50,
      verifiable: false,             // set by explore for File/Directory nodes
    });

    expect(warnings, 'a correct file block must raise nothing').toEqual([]);
    expect(text).not.toMatch(/WRONG BODY/);

    // And the guard must be the FLAG, not luck: the same block with verifiable defaulted
    // would fire, which is exactly the shipped bug.
    const { warnings: unguarded } = renderSourceBlock({
      symbol: 'target.cpp', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50,
    });
    expect(unguarded.map((w) => w.kind)).toContain('offset_drift');
  });

  it('an unreadable manifest DISABLES the staleness check rather than failing it', async () => {
    // Deliberate: an absent manifest is already reported by the freshness layer, so
    // inventing a second warning from it duplicates a signal instead of adding one.
    // The drift proof still runs, because it needs no manifest at all.
    const file = join(repoRoot, 'src', 'target.cpp');
    await writeFile(file, AFTER_EDIT);

    expect(manifestIndexedAtMs(repoRoot)).toBeNull();

    const { text } = renderSourceBlock({
      symbol: 'targetSymbol', filePath: 'src/target.cpp', startLine: 1, endLine: 3,
      repoRoot, perBlockLines: 50, indexedAtMs: manifestIndexedAtMs(repoRoot),
    });

    expect(text, 'drift proof needs no manifest').toMatch(/WRONG BODY/);
    expect(text).not.toMatch(/NOT Read-equivalent/);
  });
});
