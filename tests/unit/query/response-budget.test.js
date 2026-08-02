// ★ TOKEN BUDGET IS A PRODUCT REQUIREMENT, NOT A NICETY.
//
// Measured 2026-08-02 on a real repo, before these changes:
//   graph_consequences  11506 bytes  (~3110 tokens) — receipt was 51.4% of it
//   graph_pull           4395 bytes  (~1188 tokens) — receipt was 37.3%
//
// The head/body split existed and was not wired to the decision it was built for:
// the full receipt shipped by default on every call. Validation needs pins,
// reading needs claims, and you validate every time and read rarely — so the head
// is the default and the body is opt-in.
//
// And a field reviewer reading everything adversarially across three experiments
// listed the fields he never once read: overlay_quality (a 12-field block on every
// pull), trust.advisory (null in every response he saw). Both are now conditional.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '../../../mcp/stdio', p), 'utf8');

describe('receipts default to the head, body is opt-in', () => {
  it('both receipt-bearing verbs route through receiptFor', () => {
    expect(read('query/verbs/pull.js')).toMatch(/receiptFor\(buildReceipt\(/);
    expect(read('query/verbs/consequences.js')).toMatch(/receiptFor\(buildReceipt\(/);
  });

  it("receiptFor returns the head unless mode is 'full'", () => {
    const r = read('query/receipt.js');
    expect(r).toMatch(/return mode === 'full' \? receipt : receiptHead\(receipt\)/);
  });
});

describe('fields with a measured zero read-rate are conditional', () => {
  it('overlay_quality is opt-in on graph_pull, not emitted by default', () => {
    const p = read('query/verbs/pull.js');
    expect(p).toMatch(/wantOverlayQuality \? \{ overlay_quality/);
    // and it must NOT appear as an unconditional key
    expect(p).not.toMatch(/^\s+overlay_quality: overlayQuality,$/m);
  });

  it('trust.advisory is omitted rather than emitted as null', () => {
    const c = read('query/verbs/consequences.js');
    expect(c).toMatch(/\.\.\.\(level === 'weak' \? \{/);
    expect(c).not.toMatch(/advisory: level === 'weak'[\s\S]{0,120}: null,/);
  });
});
