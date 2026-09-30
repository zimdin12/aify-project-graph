// ⛔⛔ THE WIRE, BOUNDED — AND THE FIRST ARM NAMES THE BUG THAT SHIPPED.
//
// The provider's first version omitted `reporterId` from the request body. Every unit test passed, the dry run
// printed a perfect batch, and the real post would have come back 400 before any of the seam's own reasoning
// ran, because `routes/provider.ts:224` reads `required(raw, "reporterId")`.
//
// ⇒ NOTHING ON THIS SIDE COULD HAVE CAUGHT IT, and that is the point of this file. The resolver's 15 arms are
// about DECISIONS and were all green. What was wrong was the SHAPE OF THE REQUEST, which no test looked at
// because the only thing that reads it lives in another repo. A test that asserts the body's shape is the
// cheapest possible stand-in for the handler I cannot run here.
//
// ⚠ AND ITS LIMIT, STATED: these arms prove the client SENDS what their route requires as of 6132eb1. They
// cannot prove the route still requires it. If they change the contract, these stay green and the post starts
// failing — so this is a bound against MY regression, never a check on their API. The only instrument for
// that is a real post, which is why one is committed in `docs/evidence/dashboard-seam-2026-09-30/`.
import { describe, it, expect } from 'vitest';
import { DashboardSignalsClient, SignalsRefused } from '../../../scripts/lib/dashboard-signals-client.mjs';

const SECRET = 'sk-test-not-a-real-key-0123456789';

/** A fetch that records what it was asked to do and answers with whatever the arm needs. */
function recordingFetch({ status = 200, body = { kind: 'applied' } } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
  impl.calls = calls;
  return impl;
}

const client = (over = {}) => new DashboardSignalsClient({
  baseUrl: 'http://localhost:9700',
  apiKey: SECRET,
  hostKey: 'host-a',
  projectId: 'PROJ',
  ...over,
});

const batch = {
  head: 'abc123',
  watchRevision: 'rev1',
  results: [{ watchId: 'w1', status: 'restamp' }],
  unwatched: [{ watchId: 'w2', reason: 'because' }],
};

describe('the batch body carries what the route requires', () => {
  it('★★★ reporterId is in the BODY — the field whose absence is a 400', async () => {
    const fetchImpl = recordingFetch();
    await client({ fetchImpl }).postSignals(batch);

    expect(fetchImpl.calls).toHaveLength(1);
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    // ⛔ THE ARM THAT WOULD HAVE CAUGHT THE SHIPPED BUG.
    expect(sent.reporterId, 'their route reads required(raw, "reporterId"); without it this is a 400')
      .toBe('aify-project-graph');
    // And the rest of the contract, so a refactor cannot drop one while keeping the reporter.
    expect(sent.head).toBe('abc123');
    expect(sent.watchRevision, 'the revision is a compare-and-set and must travel back UNCHANGED').toBe('rev1');
    expect(sent.results).toHaveLength(1);
    expect(sent.unwatched).toHaveLength(1);
  });

  it('★★★ the reporter name is CONFIGURABLE, because two reporters is a real case', async () => {
    const fetchImpl = recordingFetch();
    await client({ fetchImpl, reporterId: 'apg-second-independent-sweeper' }).postSignals(batch);
    expect(JSON.parse(fetchImpl.calls[0].init.body).reporterId).toBe('apg-second-independent-sweeper');
  });

  it('★★★ the URL and method are the ones the service publishes', async () => {
    const fetchImpl = recordingFetch();
    const c = client({ fetchImpl });
    await c.readWatchSet();
    await c.postSignals(batch);
    expect(fetchImpl.calls[0].url).toBe('http://localhost:9700/api/v1/host/host-a/projects/PROJ/watch-set');
    expect(fetchImpl.calls[0].init.method).toBe('GET');
    expect(fetchImpl.calls[1].url).toBe('http://localhost:9700/api/v1/host/host-a/projects/PROJ/signals');
    expect(fetchImpl.calls[1].init.method).toBe('POST');
  });
});

describe('reconfirm reaches the per-project route, one anchor, fully stamped', () => {
  it('★★★ it posts to /projects/:id/watch-set/reconfirm — NOT under /host/:hostKey', async () => {
    // ⛔ Reconfirm is a per-PROJECT act (auth "either"), unlike the two host-scoped provider routes. Copying the
    // host prefix from them is the natural mistake, and it is a 404 on the live service.
    const fetchImpl = recordingFetch({ body: { watchId: 'w1', settled: ['code_changed'] } });
    const stamp = { hash: 'h', stampVersion: 'apg-symbol-shape-1', commit: 'c0ffee' };
    const out = await client({ fetchImpl }).reconfirm({ watchId: 'w1', watchRevision: 'rev1', stamp });

    expect(fetchImpl.calls[0].url).toBe('http://localhost:9700/api/v1/projects/PROJ/watch-set/reconfirm');
    expect(fetchImpl.calls[0].url, 'the host key must not appear in a per-project route').not.toContain('host-a');
    expect(fetchImpl.calls[0].init.method).toBe('POST');
    // ⛔ All three stamp fields: the service's `stampFrom` refuses a stamp missing any one as `bad_stamp`.
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({ watchId: 'w1', watchRevision: 'rev1', stamp });
    // The answer is handed back whole, so a caller can print what it SETTLED rather than assume it.
    expect(out.settled).toEqual(['code_changed']);
  });
});

describe('every request names its sender', () => {
  it('★★★ x-aify-agent carries the reporter name on reads, batches and reconfirms', async () => {
    // ⛔ Without this header the service records a reconfirm's actor as the anonymous "an agent"
    // (routes/provider.ts whoAsked), and a receipt's `admitted_as` as null. It is a CLAIM — one shared key
    // authenticates every agent — but a named one, comparable with the body's `reporterId`.
    const fetchImpl = recordingFetch();
    const c = client({ fetchImpl, reporterId: 'apg@StevenZ-L/win32/abc123' });
    await c.readWatchSet();
    await c.postSignals(batch);
    await c.reconfirm({ watchId: 'w1', watchRevision: 'rev1', stamp: { hash: 'h', stampVersion: 'v', commit: 'c' } });
    expect(fetchImpl.calls).toHaveLength(3);
    for (const call of fetchImpl.calls) {
      expect(call.init.headers['x-aify-agent']).toBe('apg@StevenZ-L/win32/abc123');
    }
  });
});

describe('the key is held, never carried anywhere it could be read', () => {
  it('★★★ it travels ONLY in the x-api-key header', async () => {
    const fetchImpl = recordingFetch();
    await client({ fetchImpl }).postSignals(batch);
    const { url, init } = fetchImpl.calls[0];

    // POSITIVE CONTROL FIRST: the key must actually be sent, or the assertions below pass on a client that
    // authenticates with nothing at all.
    expect(init.headers['x-api-key'], 'the key must be sent, or these arms prove nothing').toBe(SECRET);
    // ⛔ AND NOWHERE ELSE. A key in a URL lands in every access log and every shell history.
    expect(url).not.toContain(SECRET);
    expect(init.body).not.toContain(SECRET);
  });

  it('★★★ describe() names where it points and NOT what it holds', () => {
    const described = client().describe();
    // POSITIVE CONTROL: it says something useful, so the absence below is not the absence of all output.
    expect(described).toContain('host-a');
    expect(described).toContain('PROJ');
    expect(described).not.toContain(SECRET);
  });

  it('★★★ a missing key FAILS CLOSED at construction, before any request', () => {
    const fetchImpl = recordingFetch();
    // ⛔ A guard that passes when its input is missing is decoration. Letting the request go and reading a 401
    // would put the key's absence in someone else's logs.
    for (const apiKey of [undefined, null, '', '   ']) {
      expect(() => client({ fetchImpl, apiKey }), `apiKey ${JSON.stringify(apiKey)} must refuse`).toThrow(/apiKey/u);
    }
    expect(fetchImpl.calls, 'nothing may reach the network').toHaveLength(0);
    // The three address fields fail closed too, and for the same reason.
    expect(() => client({ fetchImpl, projectId: undefined })).toThrow(/projectId/u);
  });
});

describe('a refusal keeps the part that says what to do about it', () => {
  it('★★★ a 409 is flagged for RE-READ rather than left to a string match', async () => {
    const fetchImpl = recordingFetch({
      status: 409,
      body: { code: 'stale_watch_revision', message: 'the set is now deadbeef. Re-read the watch set' },
    });
    await expect(client({ fetchImpl }).postSignals(batch)).rejects.toThrow(SignalsRefused);
    try {
      await client({ fetchImpl }).postSignals(batch);
      throw new Error('it should have refused');
    } catch (error) {
      expect(error.code).toBe('stale_watch_revision');
      expect(error.status).toBe(409);
      // ⛔ A FLAG, NOT A STRING MATCH ON THE MESSAGE. Matching prose is a check that breaks the day the wording
      // improves, and their wording is the part most likely to improve.
      expect(error.shouldReread).toBe(true);
      // ⚠ And the message survives: it is the only part of a refusal that says what to do next.
      expect(error.message).toContain('Re-read the watch set');
    }
  });

  it('★★★ an ordinary refusal is NOT flagged for re-read', async () => {
    // ⛔ THE CONTROL WITHOUT WHICH THE ARM ABOVE MEANS NOTHING. A client that set shouldReread unconditionally
    // would pass it, and would then loop for ever on a 400 that no re-read can fix.
    const fetchImpl = recordingFetch({ status: 400, body: { code: 'bad_result', message: 'a result names its watchId' } });
    try {
      await client({ fetchImpl }).postSignals(batch);
      throw new Error('it should have refused');
    } catch (error) {
      expect(error.code).toBe('bad_result');
      expect(error.shouldReread).toBe(false);
    }
  });

  it('★★★ a non-JSON body is reported as itself, not as a parse crash', async () => {
    const fetchImpl = recordingFetch({ status: 502, body: undefined });
    const impl = async () => ({ ok: false, status: 502, text: async () => '<html>gateway</html>' });
    impl.calls = fetchImpl.calls;
    try {
      await client({ fetchImpl: impl }).postSignals(batch);
      throw new Error('it should have refused');
    } catch (error) {
      // A proxy in the way is a different problem from a refused batch, and the operator needs to see which.
      expect(error.status).toBe(502);
      expect(error.message).toContain('not JSON');
    }
  });
});
