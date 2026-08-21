// ⛔ AN EVIDENCE ARTIFACT MUST DECODE TO THE BYTES ITS RECEIPT NAMES.
//
// The first evidence commit wrote RAW runner output to tracked files. Raw vitest output contains
// ANSI escapes (0x1b), and `no-raw-nul-bytes` forbids control bytes in tracked source — so the
// evidence commit turned the suite red.
//
// ⛔⛔ AND I DID NOT SEE IT, because of an ordering gap worth naming: the COMMIT_BOUND receipt was
// produced on a worktree at the PARENT commit, before the artifacts existed. **An evidence-only
// commit was therefore never itself gated.** The receipt certified its parent honestly and said
// nothing about the commit carrying it — which is correct by design, and leaves exactly this hole.
//
// ⇒ Artifacts are now BASE64 ENCODED TRANSPORT: the exact bytes stay recoverable while the tracked
// file contains none of them. This gate is what makes that honest — decode, re-hash, compare.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RECEIPTS = fileURLToPath(new URL('../../../docs/evidence/gate-receipts', import.meta.url));
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Every committed receipt directory, derived from disk. */
const receiptDirs = () => (existsSync(RECEIPTS) ? readdirSync(RECEIPTS)
  .map((d) => join(RECEIPTS, d))
  .filter((d) => existsSync(join(d, 'receipt.json'))) : []);

describe('every committed gate receipt has decodable, hash-matching artifacts', () => {
  it('★★★ there is at least one receipt to check', () => {
    // ⛔ POSITIVE CONTROL: "all artifacts match" is trivially true of no receipts, and a wrong zero
    // here agrees with exactly what we hope to see.
    expect(receiptDirs().length).toBeGreaterThan(0);
  });

  it('★★★ every artifact decodes to bytes hashing to its recorded fullHash', () => {
    // This is the contract base64 transport rests on. Without it, "encoded" would just mean
    // "unreadable", and an artifact could drift from the hash that names it with nothing noticing.
    const problems = [];
    for (const dir of receiptDirs()) {
      const receipt = JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8'));
      for (const gate of receipt.gates) {
        for (const stream of ['stdout', 'stderr']) {
          const cap = gate[stream];
          const path = join(dir, cap.artifact);
          if (!existsSync(path)) { problems.push(`${cap.artifact}: MISSING`); continue; }
          const bytes = cap.encoding === 'base64'
            ? Buffer.from(readFileSync(path, 'utf8'), 'base64')
            : readFileSync(path);
          if (sha(bytes) !== cap.fullHash) problems.push(`${cap.artifact}: hash mismatch`);
          if (bytes.length !== cap.capturedBytes) problems.push(`${cap.artifact}: length mismatch`);
        }
      }
    }
    expect(problems, 'an artifact that does not match its hash names bytes nobody kept').toEqual([]);
  });

  it('★★★ no committed artifact contains a raw control byte', () => {
    // ⛔ THE DEFECT THAT TURNED THE SUITE RED. Encoded transport exists precisely so evidence can be
    // preserved byte-exact WITHOUT putting escapes into tracked files.
    const offenders = [];
    for (const dir of receiptDirs()) {
      for (const f of readdirSync(dir)) {
        const buf = readFileSync(join(dir, f));
        for (const b of buf) {
          if (b === 0x1b || b === 0x00 || b === 0x7f || b === 0x0b || b === 0x0c) {
            offenders.push(`${f}: 0x${b.toString(16)}`);
            break;
          }
        }
      }
    }
    expect(offenders, 'evidence must be encoded, not raw, when it carries control bytes').toEqual([]);
  });

  it('★★★ CONTROL: the decode-and-compare can FAIL', () => {
    // Without this, "every artifact matches" is satisfied by a comparison that always agrees.
    const original = Buffer.from('some run output');
    const encoded = original.toString('base64');
    expect(sha(Buffer.from(encoded, 'base64'))).toBe(sha(original));
    expect(sha(Buffer.from(`${encoded}IA==`, 'base64')), 'a tampered artifact must not match')
      .not.toBe(sha(original));
  });
});
