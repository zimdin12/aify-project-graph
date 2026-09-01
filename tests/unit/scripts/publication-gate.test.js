// The publication gate must be able to FAIL, and be shown doing so.
//
// ⛔ WHY THIS EXISTS. The gate is what an evidence-publication commit passes INSTEAD of a full
// suite. A validator that silently started passing everything would let unverified content onto
// main under the appearance of a check — the dead-instrument shape this repository keeps finding.
//
// ⚠ AND IT ALREADY HAPPENED HERE. Extracting `evaluatePublication` from the CLI rebuilt one regex
// inside a TEMPLATE LITERAL, where `\|` collapses to `|` and `\s` to `s`. The pattern became an
// alternation with an empty branch, matching every string, so the sidecar-schema check passed
// vacuously. The CLI path was correct; the extraction was not. This file is what caught it.
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { evaluatePublication } from '../../../scripts/publication-rules.mjs';

const RECEIPT = Buffer.from(['  Tests  10 passed', '', 'VITEST_EXIT=0', ''].join('\n'), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const sidecar = ({ receipt = RECEIPT, digest = null, fields = null } = {}) => {
  const rows = fields ?? [
    '| subject commit | `0123456789abcdef0123456789abcdef01234567` |',
    '| VITEST_EXIT | **0** |',
    '| raw receipt | `suite.txt` |',
    `| raw receipt sha256 | \`${digest ?? sha(receipt)}\` |`,
  ];
  return {
    name: 'suite.SIDECAR.md',
    text: `# Receipt binding\n\n${rows.join('\n')}\n`,
    raw: { name: 'suite.txt', bytes: receipt, exists: true, tracked: true },
  };
};

const failed = (results) => results.filter((r) => !r.ok).map((r) => r.name);
const ok = (results) => failed(results).length === 0;

describe('publication gate', () => {
  it('POSITIVE CONTROL: a well-formed evidence publication passes', () => {
    const r = evaluatePublication({
      changedFiles: ['docs/evidence/x/receipts/suite.txt', 'docs/evidence/x/receipts/suite.SIDECAR.md'],
      sidecars: [sidecar()],
    });
    expect(failed(r), 'a valid publication must pass').toEqual([]);
    expect(r.length, 'the gate must actually evaluate checks').toBeGreaterThan(5);
  });

  it('a non-evidence path in the commit FAILS', () => {
    const r = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md', 'mcp/stdio/code-intel/providers/cpp-clangd.js'],
      sidecars: [sidecar()],
    });
    expect(failed(r)).toContain('only evidence paths changed');
  });

  it('a publication with NO sidecar FAILS', () => {
    const r = evaluatePublication({ changedFiles: ['docs/evidence/x/note.md'], sidecars: [] });
    expect(failed(r)).toContain('at least one sidecar published');
  });

  it('⛔ a MISSING schema field FAILS — the check that was vacuous', () => {
    // With the template-literal escaping bug this passed for every input, including this one.
    for (const omit of ['subject commit', 'VITEST_EXIT', 'raw receipt sha256']) {
      const rows = [
        '| subject commit | `0123456789abcdef0123456789abcdef01234567` |',
        '| VITEST_EXIT | **0** |',
        '| raw receipt | `suite.txt` |',
        `| raw receipt sha256 | \`${sha(RECEIPT)}\` |`,
      ].filter((row) => !row.includes(omit));
      const r = evaluatePublication({
        changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
        sidecars: [sidecar({ fields: rows })],
      });
      expect(failed(r), `omitting "${omit}" must fail the schema check`).toContain('sidecar schema: suite.SIDECAR.md');
    }
  });

  it('a ONE-BYTE change to the receipt FAILS the integrity check', () => {
    const tampered = Buffer.from(RECEIPT);
    tampered[0] = tampered[0] ^ 0x01;
    const r = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
      // sidecar still records the ORIGINAL digest
      sidecars: [{ ...sidecar({ digest: sha(RECEIPT) }), raw: { name: 'suite.txt', bytes: tampered, exists: true, tracked: true } }],
    });
    expect(failed(r)).toContain('raw receipt sha256 matches sidecar: suite.txt');
  });

  it('a receipt WITHOUT the VITEST_EXIT line FAILS the producer tripwire', () => {
    // A hand-written or truncated file cannot pass as a suite capture.
    const forged = Buffer.from('  Tests  10 passed\n', 'utf8');
    const r = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
      sidecars: [sidecar({ receipt: forged })],
    });
    expect(failed(r)).toContain('receipt carries VITEST_EXIT: suite.txt');
  });

  it('control bytes in the receipt FAIL — a capture that skipped the sanitising pipeline', () => {
    for (const [label, byte] of [['raw NUL', 0x00], ['ANSI escape', 0x1b]]) {
      const dirty = Buffer.concat([Buffer.from([byte]), RECEIPT]);
      const r = evaluatePublication({
        changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
        sidecars: [sidecar({ receipt: dirty })],
      });
      const expected = byte === 0 ? 'no raw NUL: suite.txt' : 'no ANSI escapes: suite.txt';
      expect(failed(r), `${label} must fail`).toContain(expected);
    }
  });

  it('an untracked or absent receipt FAILS', () => {
    const base = sidecar();
    const absent = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
      sidecars: [{ ...base, raw: { ...base.raw, exists: false } }],
    });
    expect(failed(absent)).toContain('raw receipt exists and is readable: suite.txt');

    const untracked = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
      sidecars: [{ ...base, raw: { ...base.raw, tracked: false } }],
    });
    expect(failed(untracked)).toContain('raw receipt is tracked: suite.txt');
  });

  it('NEGATIVE CONTROL: the gate does not pass everything — each failure case above is distinct', () => {
    // Guards against a validator that returns the same verdict regardless of input.
    const good = evaluatePublication({
      changedFiles: ['docs/evidence/x/suite.SIDECAR.md'],
      sidecars: [sidecar()],
    });
    const bad = evaluatePublication({ changedFiles: ['src/thing.js'], sidecars: [] });
    expect(ok(good)).toBe(true);
    expect(ok(bad)).toBe(false);
  });
});
