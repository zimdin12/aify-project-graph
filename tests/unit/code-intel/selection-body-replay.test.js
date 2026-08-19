// THE BODY MUST DETERMINE ITS OWN DIGEST — WITHOUT THE SENDER'S FILES.
//
// ⛔ graph-senior-dev's blocker 1. Their Python replay of `db3bbeb` passed, but ONLY because
// Python was re-reading the sender's live source files. The emitted member body alone could not
// reproduce the digest, because it omitted the main-file hash. Executed proof: `int a;` ->
// `int b;` (both 7 bytes) gave a BYTE-IDENTICAL body and a different digest.
//
// ⇒ That defeats the entire reason this slice exists. A receipt whose verification requires
// possessing the producer's mutable filesystem is not a receipt; it is a claim plus an
// invitation to trust.
//
// ★ THIS TEST DELIBERATELY RE-IMPLEMENTS THE ENCODING rather than importing it. Importing the
// production codec would make it assert that a function equals itself — falsifier 14 again, in
// the test written to guard against falsifier 1. The re-implementation is written from the SPEC
// (`docs/2026-08-19-selection-receipt-spec.md`), which is the shared artifact, and it stands in
// for the second-language verifier between graph-senior-dev's review passes. It is not a
// substitute for that review.
//
// ⚠ THE SOURCE FILES ARE DELETED BEFORE REPLAY, on purpose. If they still existed the test
// could pass while the body remained underdetermined — which is exactly how the first Python
// replay passed over a defect.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { selectedTuSetDigest } from '../../../mcp/stdio/code-intel/selection-digest.js';

// ── independent encoder, from the spec text only ──────────────────────────────
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; };
const f = (x) => { const b = Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8'); return Buffer.concat([u64(b.length), b]); };
const h = (b) => createHash('sha256').update(b).digest();

function replayFromBody(members) {
  const rows = members.map((m) => Buffer.concat([
    f('apg.compile-entry.v1'),
    f(m.path.normalize('NFC')),
    f(m.directory.normalize('NFC')),
    u64(m.argv.length),
    ...m.argv.map(f),
    u64(m.mainFileBytes),
    f(Buffer.from(m.mainFileSha256, 'hex')),
  ])).sort(Buffer.compare);
  return h(Buffer.concat([f('apg.selected-tu-set.v1'), u64(rows.length), ...rows.map(f)])).toString('hex');
}

let repo;
const fwd = (p) => p.split(path.sep).join('/');
const entry = (rel) => ({
  directory: fwd(repo),
  file: fwd(path.join(repo, rel)),
  arguments: ['clang++', '-c', rel],
});

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-replay-'));
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), 'int a;\n');
  fs.writeFileSync(path.join(repo, 'src', 'b.cpp'), 'int b;\n');
});
afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* already gone */ } });

describe('body-only replay', () => {
  it('★★★ reproduces the digest from the published members alone, sources deleted', () => {
    const out = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    expect(out.available).toBe(true);
    fs.rmSync(repo, { recursive: true, force: true });   // the producer's files are now gone
    expect(replayFromBody(out.rows)).toBe(out.digest);
  });

  it('★★★ matches the value graph-senior-dev computed independently in Python', () => {
    // Frozen from their replay of the same two-member fixture. Not recomputed here: it is a
    // cross-implementation checkpoint, and it survived the blocker-1 rewrite unchanged, which
    // is itself evidence the fix added information rather than altering the encoding.
    const out = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    expect(out.digest).toBe('6cf067329d0aae0aba4d3f7bbb59e5570c48e2a4ab8dea98ba7baaa0bbcc2211');
  });

  it('★★★ a same-length content change moves the BODY, so replay follows it', () => {
    const before = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    fs.writeFileSync(path.join(repo, 'src', 'a.cpp'), 'int z;\n');
    const after = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp')] });
    expect(after.digest).not.toBe(before.digest);
    expect(replayFromBody(after.rows)).toBe(after.digest);
    expect(replayFromBody(before.rows), 'the old body must not replay to the new digest')
      .not.toBe(after.digest);
  });

  it('★★★ tampering with one published member breaks replay', () => {
    // Falsifier 13 at the body layer: integrity must be recoverable from the body, and a
    // changed member must not still reproduce the advertised digest.
    const out = selectedTuSetDigest({ projectRoot: repo, entries: [entry('src/a.cpp'), entry('src/b.cpp')] });
    const tampered = out.rows.map((m, i) => (i === 0 ? { ...m, argv: [...m.argv, '-DEXTRA'] } : m));
    expect(replayFromBody(tampered)).not.toBe(out.digest);
  });
});
