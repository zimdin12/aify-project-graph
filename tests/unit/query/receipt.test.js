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
import { buildReceipt, validateReceipt, receiptHead, verifyReceiptIntegrity, openReceiptBody, hashWorktreeDirty, assessTruncation, PINNED_INPUTS, RECEIPT_VERSION } from '../../../mcp/stdio/query/receipt.js';

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
    // server commit, compile DB hash, index readiness and the overlay each moved
    // the output while the tree stood still.
    //
    // This assertion originally listed `overlay_age_days`, and that was the defect
    // rather than the guarantee — see A2. The overlay is still pinned; it is
    // pinned by CONTENT, because an age is a measurement and measurements cannot
    // serve as invalidation conditions. Updated, not deleted: the property being
    // asserted is right, the field that expressed it was wrong.
    for (const k of ['repo_commit', 'indexed_commit', 'server_commit', 'compile_db_hash', 'overlay_content_hash', 'index_ready']) {
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

// ═══ ★ ef-manager's PRE-REGISTERED ATTACKS (2026-07-31) ═══
//
// He wrote these as PREDICTIONS before he could execute them, labelled as such,
// and refused to report any as findings until run. Two were outside the weak spots
// I had named — which was the population I told him I could not find myself. All
// six confirmed against the code.
describe('★ A1 — the head/body split separated the address from the thing it addresses', () => {
  // He proposed the split and flagged its cost in the next message: the content
  // address closes body tampering ONLY IF the body is checked against head.id, but
  // validateReceipt works on the head ALONE by design. A validated head followed by
  // an unchecked body reads as verified, and the address is then present and doing
  // nothing — worse than absent, because it reassures.
  it('refuses a body that does not hash to its own id', () => {
    const r = base();
    const h = receiptHead(r);
    expect(openReceiptBody(h, { ...r, claims: r.claims.slice(1) }).ok).toBe(false);
  });

  it('refuses a valid body paired with the wrong head', () => {
    const r = base();
    const other = buildReceipt({ verb: 'other', args: {}, pins: r.pinned_inputs, claims: [] });
    const res = openReceiptBody(receiptHead(r), other);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('head_body_mismatch');
  });

  it('opens a matching pair, so the check is the door rather than an extra step', () => {
    // A verify function you must remember to call is one that gets skipped.
    const r = base();
    expect(openReceiptBody(receiptHead(r), r).ok).toBe(true);
  });
});

describe('★ A2 — a pin must be an identity, never a measurement', () => {
  it('pins the overlay by CONTENT, not by age', () => {
    // now-minus-mtime false-drifts daily, false-drifts on a byte-identical
    // regeneration, and — the dangerous one — FALSE MATCHES when a rewritten
    // overlay is replayed at the moment its computed age equals the stored number.
    expect(PINNED_INPUTS).toContain('overlay_content_hash');
    expect(PINNED_INPUTS).not.toContain('overlay_age_days');
  });

  it('still reports the age, structurally separated so nothing can validate on it', () => {
    const r = buildReceipt({ verb: 'v', args: {}, pins: {}, claims: [], reported_context: { overlay_age_days: 96 } });
    expect(r.reported_context.overlay_age_days).toBe(96);
    expect(r.pinned_inputs.overlay_age_days).toBeUndefined();
  });
});

describe('★ A3 — a clean commit pair over a dirty tree', () => {
  it('pins uncommitted tracked state', () => {
    // repo_commit matches, indexed_commit matches, and someone has forty
    // uncommitted modifications open. No rebuild required, and nothing said so.
    expect(PINNED_INPUTS).toContain('worktree_dirty_hash');
  });

  it('distinguishes a known-clean tree from an unknown one', () => {
    expect(hashWorktreeDirty([])).toBe('clean');
    expect(hashWorktreeDirty(null)).toBe(null); // unknown is not clean
  });

  it('is order-independent so the same dirty set hashes the same', () => {
    expect(hashWorktreeDirty(['b.js', 'a.js'])).toBe(hashWorktreeDirty(['a.js', 'b.js']));
  });
});

describe('★ B1/B2 — the two he predicted from my own list, both confirmed', () => {
  it('reports how many pins the verdict actually rests on', () => {
    // 5 nulls + 1 match reported valid:true on one-sixth of the evidence, and the
    // caller had to read the pin block to find out. A validation that LOOKS
    // complete converts a known gap into an invisible one — my own unpinned_inputs
    // principle, turned back on me one level in.
    const r = buildReceipt({ verb: 'v', args: {}, pins: { repo_commit: 'abc' }, claims: [] });
    const v = validateReceipt(r, { repo_commit: 'abc' });
    expect(v.valid).toBe(true);
    expect(v.pins_compared).toBe(`1/${PINNED_INPUTS.length}`);
    expect(v.partial_warning).toMatch(/close to meaningless/);
  });

  it('treats a type change as drift instead of coercing it away', () => {
    // String(96) === String("96") let a JSON round-trip through a different
    // representation pass as an unchanged input.
    const r = buildReceipt({ verb: 'v', args: {}, pins: { repo_commit: 96 }, claims: [] });
    const v = validateReceipt(r, { repo_commit: '96' });
    expect(v.valid).toBe(false);
    expect(v.drifted[0].note).toMatch(/type changed/);
  });
});

// ═══ ★ ATTACK SEVEN + THE BUG GENERATOR ═══
//
// ef-manager found attack seven in his own experiment-2 transcript with no running
// build, from one observation: co_consumer_files returned EXACTLY 10 and — alone
// among every list in the response — carried no total, no truncated, no limit.
// Confirmed at consequences.js: a hard `break` at 10, emitted as a bare array.
//
// Measured after the fix: ChunkDataCache.h total 10 / truncated false — HIS
// HEADLINE RESULT WAS NOT TRUNCATED, the 10 was the true count. WorldBuffer.h
// total 43 / truncated true — the defect was real and severe. Both facts matter:
// the mechanism was broken while his particular number happened to be safe.
//
// ★ And his structural fix, which he built from a sentence I wrote about a
// different field ("unknown is not clean") and applied where it pays: exhaustive
// was computed by AND-ing conditions, so a MISSING truncation flag evaluated
// falsy, read as "not truncated", and was PERMISSIVE. The default direction of
// failure was toward claiming completeness — a bug GENERATOR, producing instances
// faster than they could be fixed one at a time. Four in one day.
describe('★ unknown is not untruncated — the default fails closed now', () => {
  it('refuses an exhaustive claim built on a bare array', () => {
    // A bare array cannot prove it was not cut. This is the exact shape of
    // co_consumer_files, which won an experiment while silently stopping at 10.
    const r = buildReceipt({
      verb: 'v', args: {}, pins: {}, claims: [],
      floor: { exhaustive: true, sources: [['co_consumer_files', [1, 2, 3]]] },
    });
    expect(r.floor.exhaustive).toBe(false);
    expect(r.floor.downgraded_from_declared_exhaustive).toBe(true);
    expect(r.floor.cause).toMatch(/truncation state unknown for co_consumer_files/);
  });

  it('refuses when a source is known truncated', () => {
    const r = buildReceipt({
      verb: 'v', args: {}, pins: {}, claims: [],
      floor: { exhaustive: true, sources: [['docs', { items: [1], total: 19, truncated: true }]] },
    });
    expect(r.floor.exhaustive).toBe(false);
    expect(r.floor.cause).toMatch(/docs was truncated/);
  });

  it('allows an exhaustive claim only when every source PROVES it was not cut', () => {
    const r = buildReceipt({
      verb: 'v', args: {}, pins: {}, claims: [],
      floor: { exhaustive: true, sources: [['a', { items: [1], total: 1, truncated: false }]] },
    });
    expect(r.floor.exhaustive).toBe(true);
  });

  it('treats a missing truncated field as unknown, not as false', () => {
    // The generator itself: `!list.truncated` on an object lacking the key is
    // truthy-permissive. It has to be an explicit boolean.
    const t = assessTruncation([['x', { items: [1], total: 1 }]]);
    expect(t.proven).toBe(false);
    expect(t.unknown).toContain('x');
  });

  it('ignores absent fields, which claim nothing either way', () => {
    expect(assessTruncation([['x', null]]).proven).toBe(true);
  });
});

// ═══ ★ THE THIRD COMPARISON CASE — the one a claim_count cannot cover ═══
//
// When the receipt body moved behind an opt-in, the head carried `claim_count` and
// the body_note argued: pin drift is detectable head-only, and if the pins drifted
// the claims are moot, so the body is never worth fetching.
//
// ef-manager's counterexample: that is valid for TWO of three cases and drops the
// third, which is the one the receipt exists for —
//
//     pins drift              head sufficient (claims are moot)
//     pins match, all agree   head sufficient
//   ★ pins match, claim DIFFERS   claim_count 27 === 27 says NOTHING about
//                                 whether they are the same 27
//
// And the deleted how_to_use sentence had named that path exactly: "if the pins
// match but a claim differs, THE DIFFERENCE IS THE FINDING". A content hash of the
// canonical claims restores it head-only for ~16 bytes, and comparing one hash
// beats diffing 27 objects by eye.
describe('★ the head detects a differing answer, not just drift', () => {
  const withClaims = (claims) => buildReceipt({
    verb: 'v', args: { x: 1 }, pins: { repo_commit: 'abc' }, claims,
    floor: { exhaustive: false, cause: 'overlay-derived' },
  });

  it('carries a claims_digest, not only a count', () => {
    const h = receiptHead(withClaims([{ field: 'a', value: '1' }]));
    expect(h.claims_digest).toMatch(/^[0-9a-f]{16}$/);
  });

  it('★ same COUNT, different CLAIMS → different digest', () => {
    // The exact case claim_count cannot see.
    const a = receiptHead(withClaims([{ field: 'a', value: '1' }, { field: 'b', value: '2' }]));
    const b = receiptHead(withClaims([{ field: 'a', value: '1' }, { field: 'b', value: 'DIFFERENT' }]));
    expect(a.claim_count).toBe(b.claim_count);
    expect(a.claims_digest).not.toBe(b.claims_digest);
  });

  it('identical claims → identical digest, so agreement is also detectable', () => {
    const claims = [{ field: 'a', value: '1' }];
    expect(receiptHead(withClaims(claims)).claims_digest)
      .toBe(receiptHead(withClaims(claims)).claims_digest);
  });

  it('keeps floor_cause — a bare `exhaustive:false` with no reason gets skimmed past', () => {
    const h = receiptHead(withClaims([]));
    expect(h.exhaustive).toBe(false);
    expect(h.floor_cause).toBe('overlay-derived');
  });

  it('keeps unpinned_warning with the list, because two field names are not a warning', () => {
    const h = receiptHead(buildReceipt({ verb: 'v', args: {}, pins: { repo_commit: 'abc' }, claims: [] }));
    expect(h.unpinned_inputs.length).toBeGreaterThan(0);
    expect(h.unpinned_warning).toMatch(/weaker evidence than it looks/);
  });
});
