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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { selectedTuSetDigest, RECEIPT_CAUSES } from '../../../mcp/stdio/code-intel/selection-digest.js';

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

  // ⛔ THE ALIAS TESTS ARE RETIRED WITH THE BEHAVIOUR THEY PINNED. graph-senior-dev's ruling:
  // this population is a compile-entry MULTISET, two entries spelling one physical file
  // differently are still two selected entries, and the selector never merges anything — so the
  // refusal protected nothing and only cost availability. The `process.platform === 'win32'`
  // predicate behind it was a STAND-IN for a filesystem property that is wrong on macOS (folds
  // while `darwin` says false) and on case-sensitive Windows directories.
  // ⇒ Removing a check is the right fix when the check was guarding an invariant nothing could
  // violate. Recorded here so it is not re-proposed as a safety improvement.

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

describe('the selection body is isolated from its caller and frozen after return', () => {
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

describe('the RETURNED body cannot be mutated after the digest is fixed', () => {
  // ⛔ graph-senior-dev executed this on the OUTPUT, not the input: `r.rows[0].argv[1]='-O3'`
  // and `r.rows[0].mainFileSha256='00…'` both landed, leaving the digest fixed while the body
  // moved. Input isolation was necessary and not sufficient, and my earlier test's TITLE claimed
  // the property its body did not check.
  //
  // ⚠ It matters because wiring is a later step: a caller takes this object, adds
  // query/result/authority fields, and content-addresses the whole thing. A mutation anywhere in
  // that interval produces a self-contained receipt that is internally inconsistent — worse than
  // one that is obviously incomplete.
  it('★★★ argv is frozen', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    expect(() => { r.rows[0].argv[1] = '-O3'; }).toThrow();
    expect(r.rows[0].argv).toEqual(['clang++', '-c', 'src/a.cpp']);
  });

  it('★★★ the member fields are frozen', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    const original = r.rows[0].mainFileSha256;
    expect(() => { r.rows[0].mainFileSha256 = '0'.repeat(64); }).toThrow();
    expect(r.rows[0].mainFileSha256).toBe(original);
  });

  it('★★★ the rows array and the result object are frozen', () => {
    const r = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    expect(() => { r.rows.push({ path: 'phantom' }); }).toThrow();
    expect(() => { r.digest = '0'.repeat(64); }).toThrow();
    expect(r.rows.length).toBe(1);
  });
});

describe('the cause vocabulary governs the emitters', () => {
  // ⛔ THE ENUM WAS DOCUMENTARY, NOT OPERATIONAL. The docs ratchet read `Object.values(
  // RECEIPT_CAUSES)` while every refusal still passed a string literal, so a future
  // `refuse('new_undocumented_cause', …)` would ship in production while the test kept checking
  // the unchanged enum and passing. The harvester stopped going empty and became DISCONNECTED
  // from its emitter population instead — a checker certifying a vocabulary it does not govern.
  // ⇒ Structural, not by inspection: a literal-string call to `refuse` fails here, so adding a
  // cause forces an enum change, which the docs ratchet then sees.
  it('★★★ no refusal passes a string literal — every cause comes from the enum', () => {
    const src = readFileSync(
      fileURLToPath(new URL('../../../mcp/stdio/code-intel/selection-digest.js', import.meta.url)),
      'utf8',
    );
    const literals = [...src.matchAll(/refuse\(\s*'([^']+)'/g)].map((m) => m[1]);
    expect(literals, 'use RECEIPT_CAUSES.X so the documented vocabulary governs what ships')
      .toEqual([]);
  });

  it('★★★ every enum value is reachable as a real refusal or explicitly reserved', () => {
    // Guards the other direction: an enum that lists causes nothing can emit is a contract
    // describing a product that does not exist.
    const src = readFileSync(
      fileURLToPath(new URL('../../../mcp/stdio/code-intel/selection-digest.js', import.meta.url)),
      'utf8',
    );
    const RESERVED = new Set(['population_transport_unavailable']);
    const used = new Set([...src.matchAll(/RECEIPT_CAUSES\.([A-Z_]+)/g)].map((m) => m[1]));
    for (const [key, value] of Object.entries(RECEIPT_CAUSES)) {
      if (RESERVED.has(value)) continue;
      expect(used.has(key), `${value} is declared but never emitted`).toBe(true);
    }
  });
});

describe('the selection requires the population root it is for', () => {
  it('★★★ refuses an empty projectRoot even with an empty entry list', () => {
    // Non-blocking hardening from graph-senior-dev: an empty selection could be issued with no
    // project scope at all. The final receipt pins project/query separately, but a population
    // without the root it describes is a claim with no subject.
    const r = selectedTuSetDigest({ projectRoot: '', entries: [] });
    expect(r.available).toBe(false);
    expect(r.cause).toBe('no_project_root');
  });
});
