// ⛔⛔ A SWEEP RESERVES BEFORE IT MEASURES, CARRIES ITS ID, AND STOPS ON A STALE ANSWER INSTEAD OF RETRYING.
//
// The dashboard's sweep identity (aify-dashboard ec55995, schema 43, DESIGN-QUIET-ANCHORS step 3). Read from
// their route code at that commit, not from the message describing it:
//   reserve  POST /api/v1/host/:hostKey/projects/:projectId/sweeps  {reporterId, head}
//            -> {sweepId, predecessor, watchRevision, items, baselineDigest}   (routes/sweeps.ts, provider/sweeps.ts)
//   post     the signals body plus `sweep: {id, predecessor}`, predecessor present even when null;
//            `sweep: null` is bad_sweep, so an unswept post must OMIT the key   (provider/sweeps.ts sweepFrom)
//   answers  200 kind applied|repeat; 409 stale_sweep (recorded, no mark; stop, exit 3);
//            409 stale_baseline | stale_watch_revision (re-reserve and re-measure); 409 inconsistent_retry,
//            unknown_sweep, sweeps_adopted; 400 bad_sweep   (routes/provider.ts SIGNALS_STATUS)
import { describe, it, expect } from 'vitest';
import { DashboardSignalsClient, SignalsRefused } from '../../../scripts/lib/dashboard-signals-client.mjs';
import { outcomeOfPost } from '../../../scripts/lib/sweep-outcome.mjs';

function recordingFetch({ status = 200, body = {} } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
  };
  impl.calls = calls;
  return impl;
}
const client = (over = {}) => new DashboardSignalsClient({
  baseUrl: 'http://localhost:9700', apiKey: 'sk-test-0123456789', hostKey: 'host-a', projectId: 'PROJ',
  reporterId: 'apg@test-host/win32/00000000', ...over,
});
const RESERVED = Object.freeze({
  sweepId: 4, predecessor: 3, watchRevision: 'rev9', items: [{ watchId: 'w1' }], baselineDigest: 'd1',
});
const batch = { head: 'abc123', watchRevision: 'rev9', results: [{ watchId: 'w1', status: 'unchanged' }], unwatched: [] };

describe('reserving a sweep', () => {
  it('★★★ it posts {reporterId, head} to the per-host sweeps route, and returns the reservation', async () => {
    const fetchImpl = recordingFetch({ body: RESERVED });
    const got = await client({ fetchImpl }).reserveSweep({ head: 'abc123' });
    expect(fetchImpl.calls[0].url).toBe('http://localhost:9700/api/v1/host/host-a/projects/PROJ/sweeps');
    expect(fetchImpl.calls[0].init.method).toBe('POST');
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({ reporterId: 'apg@test-host/win32/00000000', head: 'abc123' });
    expect(got).toEqual(RESERVED);
  });

  it('★★★ a reservation it cannot use is refused HERE, not measured against', async () => {
    // Measuring against a set that did not arrive, or posting an id that is not one, fails later and less clearly.
    const broken = [
      { ...RESERVED, sweepId: 0 },
      { ...RESERVED, sweepId: '4' },
      { sweepId: 4, watchRevision: 'rev9', items: [] },
      { ...RESERVED, predecessor: 0 },
      { ...RESERVED, watchRevision: 7 },
      { ...RESERVED, items: null },
    ];
    for (const body of broken) {
      await expect(client({ fetchImpl: recordingFetch({ body }) }).reserveSweep({ head: 'abc123' }), JSON.stringify(body))
        .rejects.toThrow(/reservation/u);
    }
    // CONTROL: a first reservation, whose predecessor is null, is accepted.
    await expect(client({ fetchImpl: recordingFetch({ body: { ...RESERVED, predecessor: null } }) }).reserveSweep({ head: 'abc123' }))
      .resolves.toMatchObject({ predecessor: null });
  });
});

describe('the post carries its sweep', () => {
  it('★★★ `sweep: {id, predecessor}` travels, with a null predecessor PRESENT, not dropped', async () => {
    const fetchImpl = recordingFetch({ body: { kind: 'applied' } });
    await client({ fetchImpl }).postSignals({ ...batch, sweep: { id: 1, predecessor: null } });
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.sweep).toEqual({ id: 1, predecessor: null });
    expect(Object.hasOwn(sent.sweep, 'predecessor')).toBe(true);
  });

  it('★★★ CONTROL: a post with no sweep OMITS the key; `sweep: null` would be refused as bad_sweep', async () => {
    const fetchImpl = recordingFetch({ body: { kind: 'applied' } });
    await client({ fetchImpl }).postSignals(batch);
    expect(Object.hasOwn(JSON.parse(fetchImpl.calls[0].init.body), 'sweep')).toBe(false);
  });
});

describe('a refusal says which recovery it needs, by code', () => {
  const refusal = (status, code) => new SignalsRefused(status, { code, message: `${code} text` });

  it('★★★ stale_baseline and stale_watch_revision are re-read; stale_sweep is NOT, it is its own flag', () => {
    expect(refusal(409, 'stale_baseline').shouldReread).toBe(true);
    expect(refusal(409, 'stale_watch_revision').shouldReread).toBe(true);
    expect(refusal(409, 'stale_sweep').shouldReread).toBe(false);
    expect(refusal(409, 'stale_sweep').staleSweep).toBe(true);
  });

  it('★★★ CONTROL: other 409s are neither, because re-reading cannot fix them', () => {
    // Every 409 used to set shouldReread. inconsistent_retry and unknown_sweep say the BODY contradicts what was
    // sent before; re-reading and posting the same thing again would loop.
    for (const code of ['inconsistent_retry', 'unknown_sweep', 'sweeps_adopted', 'incomplete_batch']) {
      expect(refusal(409, code).shouldReread, code).toBe(false);
      expect(refusal(409, code).staleSweep, code).toBe(false);
    }
  });
});

describe('a refusal keeps the service\'s own words', () => {
  it('★★★ the text arrives in `error`, beside `code`, and reaches the message', async () => {
    // The service's real refusal body (http/server.ts at ec55995): `{ ...details, error: message, code }`. The
    // client read `body.message`, which the service never sends, so every refusal printed "no message", including
    // the stale_sweep text that is the only place the current cursor is named. Found on the first live run; the
    // earlier unit test passed because its fake body used a `message` field the real one does not have.
    const fetchImpl = recordingFetch({ status: 409, body: { error: 'a later sweep was applied first: the cursor is at 5', code: 'stale_sweep' } });
    const thrown = await client({ fetchImpl }).postSignals(batch).catch((e) => e);
    expect(thrown).toBeInstanceOf(SignalsRefused);
    expect(thrown.code).toBe('stale_sweep');
    expect(thrown.detail).toBe('a later sweep was applied first: the cursor is at 5');
    expect(thrown.message).toContain('the cursor is at 5');
  });
});

describe('what a run does with the answer', () => {
  it('★★★ applied and repeat succeed', () => {
    expect(outcomeOfPost({ reply: { kind: 'applied', sweepId: 4 } }).exit).toBe(0);
    expect(outcomeOfPost({ reply: { kind: 'repeat', sweepId: 4 } }).exit).toBe(0);
  });

  it('★★★ stale_sweep stops with exit 3, as agreed: no automatic re-sweep', () => {
    const out = outcomeOfPost({ refusal: new SignalsRefused(409, { code: 'stale_sweep', message: 'the cursor is at 5' }) });
    expect(out.exit).toBe(3);
    expect(out.line).toMatch(/cursor is at 5/u);
  });

  it('★★★ a stale baseline or revision exits 2 and says to run again, which reserves afresh', () => {
    for (const code of ['stale_baseline', 'stale_watch_revision']) {
      const out = outcomeOfPost({ refusal: new SignalsRefused(409, { code, message: 'm' }) });
      expect(out.exit, code).toBe(2);
      expect(out.line, code).toMatch(/run again/u);
    }
  });

  it('★★★ an answer it does not recognise FAILS, rather than reading as applied', () => {
    // A 200 that is not applied or repeat is something this provider was never told about. Calling it success
    // is how a stale answer moved to a 200 one day would pass unnoticed.
    expect(outcomeOfPost({ reply: { kind: 'stale' } }).exit).toBe(1);
    expect(outcomeOfPost({ reply: {} }).exit).toBe(1);
    expect(outcomeOfPost({ reply: null }).exit).toBe(1);
  });
});
