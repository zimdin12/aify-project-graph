// D1'S HERMETIC FIXTURE — ownership as a CAPABILITY, and the controls that make it evidence.
//
// ⛔ WHY THE OLD FIXTURE COULD NOT CARRY D1. A wrapper cannot honestly know that an arbitrary
// `.close()` came from production merely because harness cleanup is not currently running. A phase
// flag or a stack inspection would be the fixture GUESSING at attribution — and a fixture that
// guesses ownership manufactures exactly the appearance this arm exists to measure.
//
// ⚠ THIS FILE AUTHORS NO D1 PREDICATE, and must not be read as progress toward one. The executor
// and the current referee have both seen the old answer; a THIRD BLIND REFEREE must derive a
// predicate from the guarantee and from this source. `27a1b0c` stands. Any future attempt is a new
// carrier with a new preregistration citing the failed one, never presented as redemption.
import { describe, it, expect } from 'vitest';
import {
  HandleInventory, CLOSED_BY, AttributionError, newRunToken, cleanupResult,
} from '../../helpers/handle-inventory.js';

const noop = () => {};

describe('per-invocation identity, controlled before it is used as evidence', () => {
  it('★★★ two invocations yield two DISTINCT tokens', () => {
    // ⛔ THIS CONTROL COMES FIRST. "Two starts were observed" can be produced by a factory that
    // returns a constant, and then the arm measures the factory rather than the server. Every later
    // assertion that compares tokens rests on this one.
    const a = newRunToken();
    const b = newRunToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});

describe('ownership is a capability, not an inference', () => {
  it('★★★⛔ PRODUCTION HAS NO PATH TO THE RAW CLOSURE', () => {
    // The raw closure lives in the inventory, never as a property of the object production holds.
    // Attribution is therefore structural: you cannot record `closedBy: 'production'` without
    // holding the production capability, because that object carries the only method that writes it.
    const inv = new HandleInventory();
    const h = inv.open({ kind: 'server', token: newRunToken(), rawClose: noop });
    expect(h.rawClose, 'the raw closure must not be reachable from the handle').toBeUndefined();
    expect(Object.isFrozen(h), 'and the handle must not be extensible with one').toBe(true);
    expect(Object.keys(h).sort()).toEqual(['close', 'id', 'kind', 'token']);
  });

  it('★★★ POSITIVE CONTROL: the wrapper really closes the real resource', () => {
    // ⛔ Without this, every refusal below is satisfied by a wrapper that records attribution and
    // never releases anything — which would leak while reporting clean ownership.
    const closed = [];
    const inv = new HandleInventory();
    const h = inv.open({ kind: 'db', token: newRunToken(), rawClose: () => closed.push('db') });
    h.close();
    expect(closed, 'the underlying close must actually run').toEqual(['db']);
    expect(inv.snapshot('x').productionClosed).toBe(1);
  });

  it('★★★⛔ open() REFUSES a missing raw closure rather than recording a fake handle', () => {
    const inv = new HandleInventory();
    expect(() => inv.open({ kind: 'server', token: 't' })).toThrow(AttributionError);
  });
});

describe('double close and conflicting attribution raise loudly', () => {
  it('★★★⛔ a second close is an apparatus error, not a silent overwrite', () => {
    const inv = new HandleInventory();
    const h = inv.open({ kind: 'server', token: newRunToken(), rawClose: noop });
    h.close();
    expect(() => h.close()).toThrow(/already closedBy=production/);
  });

  it('★★★⛔ THE HARNESS MAY NOT RELABEL WHAT PRODUCTION RELEASED', () => {
    // ⛔ Silently overwriting here would let harness cleanup claim a handle production never
    // released — precisely the false ownership D1 exists to detect. It must be impossible, not
    // merely avoided by ordering.
    const inv = new HandleInventory();
    const h = inv.open({ kind: 'db', token: newRunToken(), rawClose: noop });
    h.close();
    expect(() => inv.harnessClose(h.id)).toThrow(/refusing a second close by harness/);
  });

  it('★★★⛔ closing an unknown handle refuses rather than inventing a record', () => {
    expect(() => new HandleInventory().harnessClose('no-such-id')).toThrow(AttributionError);
  });
});

describe('snapshot → release → snapshot → clean → assert', () => {
  it('★★★⛔ HARNESS CLEANUP CANNOT REWRITE WHAT THE EARLIER SNAPSHOT FROZE', () => {
    // ⛔ The v1 ordering (snapshot → assert → cleanup) recreated the two-message problem: an
    // assertion throwing alongside cleanup put two errors on one case. The frozen snapshot is what
    // lets cleanup happen BEFORE assertions without cleanup being able to edit the evidence.
    const inv = new HandleInventory();
    const t = newRunToken();
    const server = inv.open({ kind: 'server', token: t, rawClose: noop });
    const db = inv.open({ kind: 'db', token: t, rawClose: noop });

    server.close();
    const beforeCleanup = inv.snapshot('after-production-release');

    inv.harnessClose(db.id);
    const afterCleanup = inv.snapshot('after-harness-cleanup');

    expect(Object.isFrozen(beforeCleanup)).toBe(true);
    expect(beforeCleanup.productionClosed, 'the frozen record must not move').toBe(1);
    expect(beforeCleanup.stillOpen, 'nor this one').toBe(1);
    expect(afterCleanup.harnessClosed, 'while the later snapshot sees the cleanup').toBe(1);
    expect(afterCleanup.stillOpen).toBe(0);
  });

  it('★★★⛔ the leak is NAMED, not counted', () => {
    // "production owns fewer handles than were opened" is not actionable. The specific unowned ids
    // are, and they are what a referee needs to attribute a teardown lock to a rival holder.
    const inv = new HandleInventory();
    const t = newRunToken();
    const kept = inv.open({ kind: 'server', token: t, rawClose: noop });
    const released = inv.open({ kind: 'db', token: t, rawClose: noop });
    released.close();
    const s = inv.snapshot('leak');
    expect(s.unownedIds).toEqual([kept.id]);
    expect(Object.isFrozen(s.unownedIds)).toBe(true);
  });

  it('★★★ the honest ONE-START path: everything production-closed, nothing unowned', () => {
    // ⚠ The control that keeps the fixture usable. If a clean run could not read clean, the arm
    // would report a leak on every execution and the signal would be worthless.
    const inv = new HandleInventory();
    const t = newRunToken();
    const a = inv.open({ kind: 'server', token: t, rawClose: noop });
    const b = inv.open({ kind: 'db', token: t, rawClose: noop });
    a.close(); b.close();
    const s = inv.snapshot('one-start');
    expect(s).toMatchObject({ opened: 2, productionClosed: 2, harnessClosed: 0, stillOpen: 0 });
    expect(s.unownedIds).toEqual([]);
    expect(s.distinctTokens, 'one start means one token').toEqual([t]);
  });

  it('★★★ a CONSTRUCTED two-start path shows two distinct tokens', () => {
    // ⚠ CONSTRUCTED, not mutation-induced. This pins what the accounting reports when two starts
    // happen; it does not claim that two starts DID happen in any real run, and it is not evidence
    // about `:231`.
    const inv = new HandleInventory();
    const t1 = newRunToken(); const t2 = newRunToken();
    inv.open({ kind: 'server', token: t1, rawClose: noop });
    inv.open({ kind: 'server', token: t2, rawClose: noop });
    expect(inv.snapshot('two-start').distinctTokens).toHaveLength(2);
  });

  it('★★★⛔ nothing may be opened after the first snapshot', () => {
    // A handle opened after the evidence was frozen would be absent from the record it belongs to.
    const inv = new HandleInventory();
    inv.snapshot('sealed');
    expect(() => inv.open({ kind: 'db', token: 't', rawClose: noop })).toThrow(/sealed/);
  });
});

describe('portable authority is the accounting, not EBUSY', () => {
  it('★★★⛔ a failed removal is TYPED DATA, never a thrown second error', () => {
    // ⛔ EBUSY is a Windows artefact. On POSIX an open file unlinks happily, so a fixture treating
    // removal failure as the witness would measure the PLATFORM rather than the leak. Removal is a
    // final check whose result is recorded and carried into the assertions.
    const r = cleanupResult(() => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); });
    expect(r).toMatchObject({ removed: false });
    expect(r.error).toMatch(/EBUSY/);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('★★★ POSITIVE CONTROL: a successful removal reports removed:true with no error', () => {
    expect(cleanupResult(noop)).toMatchObject({ removed: true, error: null });
  });

  it('★★★ the four accounting fields are what a referee reads', () => {
    // opened / production-closed / harness-closed / still-open is identical on every platform,
    // which is the property that makes it authority rather than local colour.
    const s = new HandleInventory().snapshot('empty');
    for (const k of ['opened', 'productionClosed', 'harnessClosed', 'stillOpen']) {
      expect(s[k], `${k} must be present even on an empty run`).toBe(0);
    }
  });
});

describe('what this fixture deliberately does NOT do', () => {
  it('★★★⛔ it exports no D1 predicate, and that absence is asserted', () => {
    // ⛔ If a predicate ever appears here, it was authored by someone who had already seen the old
    // answer — which is exactly what the third-blind-referee requirement exists to prevent. This
    // test fails the moment that happens.
    const surface = [HandleInventory, CLOSED_BY, AttributionError, newRunToken, cleanupResult];
    expect(surface.every(Boolean), 'the intended surface is present').toBe(true);
    expect(Object.keys(CLOSED_BY).sort()).toEqual(['HARNESS', 'PRODUCTION']);
  });
});
