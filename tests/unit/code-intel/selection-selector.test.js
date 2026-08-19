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

  it('★★★ REFUSES a case-fold path alias rather than merging two members into one', () => {
    // Falsifier 4. On a case-insensitive host both entries resolve to one file; merging them
    // would silently halve the population while the digest still claimed completeness.
    fs.writeFileSync(path.join(repo, 'src', 'A.cpp'), 'int a;\n');
    const r = selectedTuSetDigest({
      projectRoot: repo,
      entries: [entry('src/a.cpp'), entry('src/A.cpp')],
    });
    if (r.available) {
      // Case-SENSITIVE host: both are real, distinct files and both must appear.
      expect(r.rows.map((m) => m.path).sort()).toEqual(['src/A.cpp', 'src/a.cpp']);
    } else {
      expect(r.cause).toBe('path_alias_collision');
    }
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
