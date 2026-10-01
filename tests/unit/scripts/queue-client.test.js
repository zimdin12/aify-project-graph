// ⛔⛔ THE QUEUE'S TWO HOST ROUTES, AS THE SERVICE WROTE THEM (aify-dashboard routes/provider.ts at 36b6217):
//   claim   POST /api/v1/host/:hostKey/provider/claim       {limit, projectId?} -> {claimed: [{requestId, projectId, call, args, requestedAt}]}
//   result  POST /api/v1/provider/requests/:requestId/result {hostKey, ok, value, problem, provenance} -> {stored: true}
// `hostKey` in the result BODY is required (`required(raw, "hostKey")`): the service accepts a result only from the
// host that holds the claim. `ok` must be a real boolean. Refusals come back as {error, code}.
import { describe, it, expect } from 'vitest';
import { DashboardSignalsClient, SignalsRefused } from '../../../scripts/lib/dashboard-signals-client.mjs';

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
const ONE = { requestId: 'R1', projectId: 'PROJ', call: 'stamp', args: { anchors: [] }, requestedAt: 1 };

describe('claiming', () => {
  it('★★★ it claims for THIS project only, with the limit, on the per-host route', async () => {
    const fetchImpl = recordingFetch({ body: { claimed: [ONE] } });
    const got = await client({ fetchImpl }).claimRequests({ limit: 3 });
    expect(fetchImpl.calls[0].url).toBe('http://localhost:9700/api/v1/host/host-a/provider/claim');
    expect(fetchImpl.calls[0].init.method).toBe('POST');
    // projectId is ALWAYS sent: without it the service hands this host work for every project it can serve,
    // and this process serves exactly one repository.
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({ limit: 3, projectId: 'PROJ' });
    expect(got).toEqual([ONE]);
  });

  it('★★★ a claim answer it cannot use is refused HERE, before any work is done on it', async () => {
    for (const body of [{}, { claimed: null }, { claimed: [{ ...ONE, requestId: '' }] }, { claimed: [{ ...ONE, call: 7 }] }, { claimed: [{ ...ONE, projectId: undefined }] }]) {
      await expect(client({ fetchImpl: recordingFetch({ body }) }).claimRequests({ limit: 1 }), JSON.stringify(body)).rejects.toThrow(/claim/u);
    }
    // CONTROL: an empty claim is a real answer, "nothing queued", and is accepted.
    await expect(client({ fetchImpl: recordingFetch({ body: { claimed: [] } }) }).claimRequests({ limit: 1 })).resolves.toEqual([]);
  });
});

describe('posting a result', () => {
  it('★★★ it posts {hostKey, ok, value, problem, provenance} to the request\'s own route', async () => {
    const fetchImpl = recordingFetch({ body: { stored: true } });
    const provenance = { providerCommit: 'c'.repeat(40), exhaustive: false, provenance: 'apg' };
    await client({ fetchImpl }).postResult('R 1/x', { ok: true, value: { stamps: [] }, provenance });
    expect(fetchImpl.calls[0].url, 'the id is escaped into the path').toBe('http://localhost:9700/api/v1/provider/requests/R%201%2Fx/result');
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({ hostKey: 'host-a', ok: true, value: { stamps: [] }, problem: null, provenance });
  });

  it('★★★ a failure is posted with ok false and its problem, never with ok missing', async () => {
    const fetchImpl = recordingFetch({ body: { stored: true } });
    await client({ fetchImpl }).postResult('R1', { ok: false, problem: 'subgraph is not supported by this provider yet', provenance: null });
    const sent = JSON.parse(fetchImpl.calls[0].init.body);
    expect(sent.ok).toBe(false);
    expect(sent.problem).toBe('subgraph is not supported by this provider yet');
    expect(sent.value).toBeNull();
  });

  it('★★★ a refusal keeps the service\'s words, e.g. a lease that expired while working', async () => {
    const fetchImpl = recordingFetch({ status: 409, body: { error: 'the claim on this request expired', code: 'lease_expired' } });
    const thrown = await client({ fetchImpl }).postResult('R1', { ok: false, problem: 'x', provenance: null }).catch((e) => e);
    expect(thrown).toBeInstanceOf(SignalsRefused);
    expect(thrown.code).toBe('lease_expired');
    expect(thrown.detail).toBe('the claim on this request expired');
  });
});
