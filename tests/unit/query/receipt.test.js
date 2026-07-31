// ★ A RECEIPT IS NOT EVIDENCE FOR A CLAIM. IT IS THE CLAIM PLUS ITS
//   INVALIDATION CONDITIONS.
//
// ef-manager named the missing team primitive after two measured experiments
// (2026-07-31): there is no way to hand another agent a claim TOGETHER with its
// evidence, so teammates re-derive everything — or don't, and one agent's
// unaudited answer becomes three agents' shared premise.
//
// The argument for it is that he and I ran that exact failure while designing it.
// He sent a three-edge include chain as a verified finding; it was wrong, because
// he matched hop 1 on `#include` and hop 2 on a BARE FILENAME, and a bare filename
// cannot distinguish an include EDGE from a comment MENTION. Catching it took two
// files opened by hand. A replayable receipt would have surfaced it in one call.
//
// These tests pin the properties that make it a receipt rather than a citation —
// and above all the one that makes it not a CACHE.
import { describe, it, expect } from 'vitest';
import { buildReceipt, validateReceipt, receiptHead, verifyReceiptIntegrity, PINNED_INPUTS, RECEIPT_VERSION } from '../../../mcp/stdio/query/receipt.js';

const base = () => buildReceipt({
  verb: 'graph_consequences',
  args: { target: 'engine/voxel/ChunkDataCache.h' },
  pins: {
    repo_commit: 'ab31252',
    indexed_commit: 'ab31252',
    server_commit: 'f6fda11',
    compile_db_hash: 'deadbeef',
    overlay_age_days: 96,
    index_ready: true,
  },
  claims: [
    { field: 'documents_mentioning', value: 'docs/contracts/worldbuffer-authority.md', provenance: 'observed', basis: 'MENTIONS edge, 10 distinct nodes' },
    { field: 'contracts_potentially_affected', value: 'docs/contracts/modified-this-frame.md', provenance: 'inferred', basis: 'feature.contracts overlay anchor', source_age_days: 96 },
  ],
  floor: { exhaustive: false, cause: 'overlay-derived', not_checked: ['unanchored features'] },
  disconfirm: { verb: 'graph_pull', args: { node: 'x' }, expect: 'docs layer should agree' },
});

describe('the receipt is replayable, not readable', () => {
  it('carries the exact call rather than prose about it', () => {
    const r = base();
    expect(r.replay.verb).toBe('graph_consequences');
    expect(r.replay.args.target).toBe('engine/voxel/ChunkDataCache.h');
  });

  it('names the cheapest disconfirming test, not a request to trust it', () => {
    // If checking costs what redoing costs, nobody checks.
    expect(base().disconfirming_test.verb).toBe('graph_pull');
  });

  it('states its floor instead of laundering one into a fact', () => {
    const r = base();
    expect(r.floor.exhaustive).toBe(false);
    expect(r.floor.cause).toBeTruthy();
  });

  it('carries provenance PER CLAIM, not one confidence for the document', () => {
    // The hard lesson: one response held the best answer of the engagement and a
    // wrong one, from the same mechanism. A single top-level confidence would
    // re-commit the tests_adjacent bug at document scale.
    const r = base();
    expect(r.claims.find((c) => c.field === 'documents_mentioning').provenance).toBe('observed');
    expect(r.claims.find((c) => c.field === 'contracts_potentially_affected').provenance).toBe('inferred');
  });

  it('lets staleness travel on the claim itself', () => {
    expect(base().claims.find((c) => c.provenance === 'inferred').source_age_days).toBe(96);
  });
});

describe('★ a receipt that serves a stale answer is a cache — so it must refuse', () => {
  it('validates when every pinned input still matches', () => {
    const r = base();
    const v = validateReceipt(r, r.pinned_inputs);
    expect(v.valid).toBe(true);
  });

  it('REFUSES when any pinned input drifted, and never returns the old values', () => {
    const r = base();
    const v = validateReceipt(r, { ...r.pinned_inputs, server_commit: 'deadbee' });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('pinned_input_drift');
    expect(v.drifted[0].input).toBe('server_commit');
    expect(v.detail).toMatch(/do not read the stored values/);
  });

  it('refuses on repo commit drift specifically', () => {
    const r = base();
    expect(validateReceipt(r, { ...r.pinned_inputs, repo_commit: 'ffffff1' }).valid).toBe(false);
  });

  it('pins every input observed to change an answer at a fixed repo commit', () => {
    // Repo commit alone would have validated every wrong answer in the engagement:
    // server commit, compile DB hash, index readiness and overlay age each moved
    // the output while the tree stood still.
    for (const k of ['repo_commit', 'indexed_commit', 'server_commit', 'compile_db_hash', 'overlay_age_days', 'index_ready']) {
      expect(PINNED_INPUTS).toContain(k);
    }
  });
});

describe('an unverifiable pin is reported, never silently passed', () => {
  it('flags pins it could not capture at build time', () => {
    const r = buildReceipt({ verb: 'v', args: {}, pins: { repo_commit: 'abc' }, claims: [] });
    expect(r.unpinned_inputs).toContain('compile_db_hash');
    expect(r.unpinned_warning).toMatch(/weaker evidence than it looks/);
  });

  it('does not report a clean match when nothing could be compared', () => {
    // A receipt with all-null pins must not read as verified.
    const r = buildReceipt({ verb: 'v', args: {}, pins: {}, claims: [] });
    const v = validateReceipt(r, {});
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('nothing_pinned');
  });

  it('warns when only some pins were comparable', () => {
    const r = buildReceipt({ verb: 'v', args: {}, pins: { repo_commit: 'abc' }, claims: [] });
    const v = validateReceipt(r, { repo_commit: 'abc' });
    expect(v.valid).toBe(true);
    expect(v.partial_warning).toMatch(/weaker than a full match/);
  });

  it('refuses a receipt whose version it cannot interpret', () => {
    const v = validateReceipt({ receipt_version: RECEIPT_VERSION + 99 }, {});
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('unreadable_receipt');
  });
});

// ═══ CONTENT-ADDRESSING AND THE HEAD/BODY SPLIT ═══
//
// ef-manager rejected my (a)/(b)/(c) transport trichotomy as a trap, with a fact I
// should have seen myself: WE DO NOT SHARE A REPO. He works in echoes_of_the_fallen,
// I work in aify-project-graph, and a receipt written to echoes' .aify-graph/ is
// invisible to me — every exchange across this engagement would have been unserved
// by the local-file design I was about to pick. It generalizes: this project has a
// standing rule that tester and coder use SEPARATE worktrees, so cross-filesystem
// is the normal team case, not the exception.
//
// Make the body self-contained and content-addressed and the transport question
// demotes from an architecture commitment to an operational detail.
describe('★ content-addressed so transport stops being an architecture decision', () => {
  it('derives the id from the body, not from a counter or a local path', () => {
    const a = base();
    const b = base();
    expect(a.id).toMatch(/^rcpt_[0-9a-f]{16}$/);
    expect(a.id).toBe(b.id); // same content → same id, on any machine
  });

  it('changes id when any claim changes', () => {
    const a = base();
    const b = buildReceipt({
      verb: 'graph_consequences',
      args: { target: 'engine/voxel/ChunkDataCache.h' },
      pins: a.pinned_inputs,
      claims: [{ field: 'x', value: 'y', provenance: 'observed', basis: 'z' }],
      floor: { exhaustive: false, cause: 'overlay-derived', not_checked: ['unanchored features'] },
      disconfirm: a.disconfirming_test,
    });
    expect(b.id).not.toBe(a.id);
  });

  it('detects a body that was altered after issue', () => {
    const r = base();
    expect(verifyReceiptIntegrity(r).intact).toBe(true);
    const tampered = { ...r, claims: r.claims.slice(1) };
    expect(verifyReceiptIntegrity(tampered).intact).toBe(false);
    expect(verifyReceiptIntegrity(tampered).reason).toBe('id_mismatch');
  });
});

describe('★ a teammate can detect drift without transferring the body', () => {
  it('validates from the head alone', () => {
    // Validation needs only pins; reading needs claims. You validate every time
    // and read rarely — a single blob makes the cheap operation pay the cost of
    // the expensive one.
    const h = receiptHead(base());
    expect(validateReceipt(h, h.pinned_inputs).valid).toBe(true);
  });

  it('refuses from the head alone when pins drifted', () => {
    // Degrades in the right direction: if the pins moved, the claims are moot and
    // the body never needs fetching at all.
    const h = receiptHead(base());
    expect(validateReceipt(h, { ...h.pinned_inputs, repo_commit: 'ffff' }).reason).toBe('pinned_input_drift');
  });

  it('is materially smaller than the body', () => {
    const r = base();
    expect(JSON.stringify(receiptHead(r)).length).toBeLessThan(JSON.stringify(r).length);
  });

  it('still carries the disconfirming test, so the head alone is actionable', () => {
    expect(receiptHead(base()).disconfirming_test.verb).toBe('graph_pull');
  });
});
