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

  it('receiptFor tiers by mode: signals < head < full', async () => {
    // Was a grep for one literal source line, which broke the moment a THIRD
    // (cheaper) tier was added below the head — even though that change made the
    // property it cared about strictly more true. Asserting the behaviour instead:
    // the grep could not tell "the default got cheaper" from "the default broke".
    const { receiptFor } = await import('../../../mcp/stdio/query/receipt.js');
    const fixture = {
      id: 'rcpt_test', receipt_version: 1,
      replay: { verb: 'graph_consequences', args: { target: 'X' } },
      pinned_inputs: { repo_commit: 'a', indexed_commit: 'a' },
      claims: [{ field: 'callers', basis: 'CALLS edge' }],
      floor: { exhaustive: true, cause: null },
      disconfirming_test: 'rg -n "X" -- src/',
    };

    const signals = receiptFor(fixture, undefined);
    const head = receiptFor(fixture, 'head');
    const full = receiptFor(fixture, 'full');

    // The property being defended is that THE DEFAULT IS THE CHEAPEST — that is
    // what every caller pays. head-vs-full ordering is deliberately not asserted:
    // `full` returns the receipt as-is while `head` DERIVES an object carrying a
    // ~100-token body_note, so on a receipt with few claims the head is legitimately
    // larger. Asserting an order that does not hold would be a test encoding a
    // wrong belief, which this repo has shipped twice.
    const size = (o) => JSON.stringify(o).length;
    expect(size(signals), 'default is cheaper than head').toBeLessThan(size(head));
    expect(size(signals), 'default is cheaper than full').toBeLessThan(size(full));

    // ★ The default must keep the two fields that changed decisions in the field:
    // ef-manager reversed a published deletion-safety verdict on `exhaustive`
    // alone, and both managers cited disconfirming_test by name. A cheaper default
    // that dropped these would be a quality cut wearing a cost-cut label.
    expect(signals.exhaustive).toBe(true);
    expect(signals.disconfirming_test).toBe(fixture.disconfirming_test);

    // And it must name the way back, so a trimmed receipt is distinguishable from
    // a build that never produced one.
    expect(signals.full_receipt).toMatch(/receipt:"head"|receipt:"full"/);

    // The apparatus belongs to the opt-in tiers only.
    expect(signals.replay, 'replay args are not in the default').toBeUndefined();
    expect(head.replay, 'head carries replay args').toBeTruthy();
    expect(full.claims, 'full carries per-claim provenance').toBeTruthy();
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
