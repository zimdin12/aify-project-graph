// THE POPULATION SELECTOR, FIXTURED SEPARATELY FROM THE CODEC.
//
// graph-senior-dev's ruling, and the reason it is a separate file: golden digest vectors break
// "the producer computes its own expected hash", but they do NOT catch a selector that omits
// the same member before both the producer and the vector codec ever see it. A digest test
// cannot notice a row that was never offered to it.
//
// ⇒ So these assert MEMBERSHIP against real files and real compile-DB entries — literal rows,
// not hashes — and they assert the FAIL-CLOSED paths, because every one of them is a way a
// smaller population could still call itself complete. That is denominator laundering
// (falsifier 1), which is the central forgery this whole receipt exists to refuse.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectedTuSetDigest } from '../../../mcp/stdio/code-intel/selection-digest.js';

let repo;
const fwd = (p) => p.split(path.sep).join('/');

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-sel-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), 'int a;\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.cpp'), 'int b;\n');
});
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* win lock */ } });

const entry = (rel, over = {}) => ({
  directory: fwd(repo),
  file: fwd(path.join(repo, rel)),
  arguments: ['clang++', '-c', rel],
  ...over,
});

describe('the selection selector', () => {
  it('★★★ emits one member per entry, with project-relative paths', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    expect(r.available).toBe(true);
    expect(r.rows.map((m) => m.path).sort()).toEqual(['src/a.cpp', 'src/b.cpp']);
    expect(r.rows.every((m) => m.directory === '.'), 'the project root canonicalizes to "."').toBe(true);
  });

  it('★★★ member count preserves multiplicity — a duplicate entry is two members', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/a.cpp')] });
    expect(r.available).toBe(true);
    expect(r.rows.length, 'deduping here would shrink the denominator silently').toBe(2);
  });

  it('★★★ REFUSES an entry carrying only a command string', () => {
    // The spec forbids hashing a whitespace-split surrogate, and compile-db.js:200 does exactly
    // that split for an unrelated heuristic — so the temptation is right there in the codebase.
    const e = entry('src/a.cpp');
    delete e.arguments;
    e.command = 'clang++ -c "src/a b.cpp"';
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [e] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('no_argument_vector');
  });

  it('★★★ REFUSES when a selected main file cannot be read', () => {
    // An unreadable file must make the digest UNAVAILABLE, never a skipped row: dropping it
    // would remove the member from numerator and denominator at once.
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/missing.cpp')] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('main_file_unreadable');
  });

  it('★★★ REFUSES an entry that resolves outside the project root', () => {
    const outside = fwd(path.join(os.tmpdir(), 'elsewhere.cpp'));
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp', { file: outside })] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('entry_outside_project_root');
  });

  // ⚠ THIS TEST USED TO PERMIT EITHER BRANCH WITH if/else, so it asserted nothing and did not
  // pin its own comment — graph-senior-dev caught that it would pass whichever way the code
  // behaved. Now it branches on the HOST, which is a fact about the machine, not about the
  // outcome, so exactly one expectation applies per platform.
  const WIN = process.platform === 'win32';
  it.runIf(WIN)('★★★ REFUSES a case-fold alias on a case-INSENSITIVE host', () => {
    // Falsifier 4: both entries resolve to one file here, and merging them would silently halve
    // the population while the digest still claimed to describe it.
    fs.writeFileSync(path.join(repo, 'src', 'A.cpp'), 'int a;\n');
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/A.cpp')] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('path_alias_collision');
  });

  it.runIf(!WIN)('★★★ KEEPS both on a case-SENSITIVE host — they are two real files', () => {
    // The mirror defect: folding unconditionally refused a legitimate pair on POSIX, an
    // availability failure caused by a rule written for a correctness one.
    fs.writeFileSync(path.join(repo, 'src', 'A.cpp'), 'int A;\n');
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/A.cpp')] });
    expect(r.available).toBe(true);
    expect(r.rows.map((m) => m.path).sort()).toEqual(['src/A.cpp', 'src/a.cpp']);
  });

  it('★★★ a changed source byte changes the digest — the member is bound to content', () => {
    const before = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), 'int a; // touched\n');
    const after = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    expect(before.available && after.available).toBe(true);
    expect(after.digest).not.toBe(before.digest);
  });

  it('★★★ removing an entry changes the digest — equal-count substitution is not enough to hide', () => {
    // Falsifier 2, at the selector layer: swap one member for another and keep the count equal.
    const both = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    const swapped = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/a.cpp')] });
    expect(both.rows.length).toBe(swapped.rows.length);
    expect(swapped.digest, 'same count, different membership').not.toBe(both.digest);
  });
});

describe('the selection body determines its own digest', () => {
  it('★★★ a SAME-LENGTH content change changes the published body, not only the digest', () => {
    // ⛔ graph-senior-dev's blocker 1, executed: 'int a;' -> 'int b;' (both 7 bytes) produced a
    // BYTE-IDENTICAL body with a different digest, so a second agent could not recompute the
    // advertised value from the body and had to possess the sender's mutable files. That defeats
    // the only reason a self-contained receipt exists.
    const before = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), 'int b;\n');
    const after = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    expect(before.rows[0].mainFileBytes).toBe(after.rows[0].mainFileBytes);
    expect(after.digest).not.toBe(before.digest);
    expect(JSON.stringify(after.rows), 'the BODY must move when the digest moves')
      .not.toBe(JSON.stringify(before.rows));
  });

  it('★★★ every member carries the file digest as hex, matching the codec bytes', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    // 'int a;\n' — the frozen value graph-senior-dev published with the golden vectors.
    expect(r.rows[0].mainFileSha256)
      .toBe('386593f1475dc210d45a5f3d4b6bb11c065fc6fe2e08ebdd00ab4cf3a0848744');
  });

  it('★★★ members publish in the DIGEST order, not the compile-DB array order', () => {
    // Otherwise one multiset with one digest yields different content-addressed receipt IDs
    // depending only on how the DB happened to be serialized.
    const ab = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    const ba = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/b.cpp'), entry('src/a.cpp')] });
    expect(ab.digest).toBe(ba.digest);
    expect(JSON.stringify(ab.rows)).toBe(JSON.stringify(ba.rows));
  });
});

describe('the selection body cannot be changed after the digest is fixed', () => {
  it('★★★ mutating the caller argv array after the call does not change the body', () => {
    // ⛔ Blocker 2, executed: the body exported the caller's own array, so flipping '-c' to
    // '-O3' afterwards left a body describing a command the digest never covered.
    const args = ['clang++', '-c', 'src/a.cpp'];
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp', { arguments: args })] });
    expect(r.available).toBe(true);
    args[1] = '-O3';
    expect(r.rows[0].argv, 'the published member is a snapshot, not a live reference')
      .toEqual(['clang++', '-c', 'src/a.cpp']);
  });

  it('★★★ REFUSES non-string arguments rather than coercing them', () => {
    // The codec hashed '7' and '[object Object]' while the body exposed the number and the
    // object — two descriptions of one entry from one call. clang rejects these outright.
    const r = selectedTuSetDigest({
      projectRoot: repo,
      entries: [entry('src/a.cpp', { arguments: ['clang++', 7, { flag: 'x' }] })],
    });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('malformed_entry');
  });

  it('★★★ REFUSES a missing compile directory rather than inventing one', () => {
    // ⛔ Blocker 3: it defaulted to the project root, so the receipt described a carrier clangd
    // never accepted — its JSONCompilationDatabase treats a missing directory as an error.
    const e = entry('src/a.cpp');
    delete e.directory;
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [e] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('malformed_entry');
  });

  it('★★★ REFUSES an empty file field', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp', { file: '' })] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('malformed_entry');
  });
});
