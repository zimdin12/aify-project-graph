// The wire to the dashboard's code-graph seam. One object, one endpoint, no decisions.
//
// ⛔ THIS CLASS DECIDES NOTHING ABOUT THE REPOSITORY. It reads a watch set and posts a batch; every verdict
// in that batch comes from `anchor-resolver.mjs`. Keeping the transport free of judgement is what lets the
// judgement be tested without a network and the transport be read without a parser in your head.
//
// ⛔ THE KEY IS NEVER LOGGED, NEVER RETURNED, AND NEVER PUT IN AN ERROR. It is read from the environment or
// from a file by the caller and held here. `describe()` exists so a run can print WHERE it is pointed without
// printing what it is holding.

/** What the service refused, in the shape the caller has to act on. Their codes, not invented here. */
export class SignalsRefused extends Error {
  constructor(status, body) {
    const code = body?.code ?? body?.error ?? `http_${status}`;
    // ⛔ THE SERVICE'S TEXT IS IN `error`, beside `code` (aify-dashboard http/server.ts: `{ ...details, error:
    // message, code }`). This read `body.message`, which the service never sends, so every refusal printed "no
    // message". `message` is still read first, for this client's own non-JSON fallback below.
    const detail = body?.message ?? (body?.code !== undefined && typeof body?.error === 'string' ? body.error : null);
    super(`${code}: ${detail ?? 'no message'}`);
    this.name = 'SignalsRefused';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
    // ⛔ RE-READ ONLY WHERE RE-READING CAN HELP: the set or a baseline moved after this run read it. Decided by CODE,
    // not by status. Every 409 used to set this, but since sweeps a 409 also means "your body contradicts what you
    // sent before" (inconsistent_retry, unknown_sweep), where re-reading and posting again would loop. A flag
    // rather than a string match, because a match on a message breaks when the wording improves.
    this.shouldReread = REREAD_CODES.includes(code);
    // ⛔ A later sweep of this reporter was applied first. Recorded as history, changed no mark. The agreed answer
    // is to stop (exit 3), never to re-sweep automatically: two of this reporter's processes doing that would
    // keep overtaking each other.
    this.staleSweep = code === 'stale_sweep';
  }
}

/** The refusals a fresh read can fix (aify-dashboard routes/provider.ts SIGNALS_STATUS, at ec55995). */
const REREAD_CODES = Object.freeze(['stale_watch_revision', 'stale_baseline']);

/**
 * A reservation this provider can measure against, or a throw. The service's shape at ec55995
 * (provider/sweeps.ts `Reserved`): a positive integer id, a predecessor that is null or a positive integer, the
 * revision, and the items to measure.
 */
function checkedReservation(body) {
  const positive = (n) => Number.isSafeInteger(n) && n >= 1;
  const ok = body !== null && typeof body === 'object'
    && positive(body.sweepId)
    && (body.predecessor === null || positive(body.predecessor))
    && typeof body.watchRevision === 'string' && body.watchRevision !== ''
    && Array.isArray(body.items);
  if (!ok) throw new Error(`the sweep reservation is not usable: ${JSON.stringify(body).slice(0, 300)}`);
  return body;
}

/**
 * The requests a claim handed this host, or a throw. The service's shape at 36b6217 (provider/requests.ts
 * `ClaimedRequest`). An empty list is a real answer: nothing is queued.
 */
function checkedClaim(body) {
  const text = (s) => typeof s === 'string' && s !== '';
  const claimed = body?.claimed;
  const ok = Array.isArray(claimed)
    && claimed.every((r) => r !== null && typeof r === 'object' && text(r.requestId) && text(r.projectId) && typeof r.call === 'string');
  if (!ok) throw new Error(`the claim answer is not usable: ${JSON.stringify(body).slice(0, 300)}`);
  return claimed;
}

export class DashboardSignalsClient {
  #apiKey;

  constructor({ baseUrl, apiKey, hostKey, projectId, reporterId, fetchImpl = fetch }) {
    if (!baseUrl || !hostKey || !projectId) {
      throw new Error('DashboardSignalsClient needs a baseUrl, a hostKey and a projectId');
    }
    // ⛔ NO DEFAULT NAME. The service keeps one sweep cursor per reporter, and the name is derived per install in
    // provider-runtime.mjs. A constant here would put every caller that forgot it onto one shared cursor.
    if (typeof reporterId !== 'string' || reporterId.trim() === '') {
      throw new Error('DashboardSignalsClient needs a reporterId (readProviderConfig derives one per install)');
    }
    // ⛔ FAIL CLOSED ON A MISSING KEY, HERE, rather than letting the request go out and come back 401. A guard
    // that passes when its input is missing is decoration.
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
      throw new Error('DashboardSignalsClient needs an apiKey; refusing to send an unauthenticated request');
    }
    this.baseUrl = String(baseUrl).replace(/\/+$/u, '');
    this.hostKey = hostKey;
    this.projectId = projectId;
    this.#apiKey = apiKey.trim();
    this.reporterId = reporterId;
    this.fetchImpl = fetchImpl;
  }

  /** Where this client points, with nothing secret in it. Safe to print in a run log. */
  describe() {
    return `${this.baseUrl} host=${this.hostKey} project=${this.projectId} (key held, not shown)`;
  }

  get #watchSetPath() {
    return `/api/v1/host/${this.hostKey}/projects/${this.projectId}/watch-set`;
  }

  // ⚠ NOT under `/host/:hostKey` like the two above. Reconfirm is a per-PROJECT act (auth "either"), so an
  // operator in a browser and a provider on a host reach the same route. Copying the host prefix here would 404.
  get #reconfirmPath() {
    return `/api/v1/projects/${this.projectId}/watch-set/reconfirm`;
  }

  get #signalsPath() {
    return `/api/v1/host/${this.hostKey}/projects/${this.projectId}/signals`;
  }

  get #sweepsPath() {
    return `/api/v1/host/${this.hostKey}/projects/${this.projectId}/sweeps`;
  }

  /**
   * Reserve a sweep BEFORE measuring. The answer carries the set to measure (`items`, `watchRevision`), so a
   * swept run does not read the watch set separately.
   *
   * ⚠ The first reservation for a project ADOPTS sweeps for this reporter there: from then on an unswept post from
   * this reporter is refused (409 sweeps_adopted). So a dry run must never call this.
   */
  async reserveSweep({ head }) {
    return checkedReservation(await this.#send('POST', this.#sweepsPath, { reporterId: this.reporterId, head }));
  }

  /**
   * Claim queued requests for THIS project. ⛔ projectId is always sent: without it the service hands this host
   * work for every project, and this process serves exactly one repository. A claim holds for the service's lease
   * (120s at 36b6217); a result posted after it is refused as lease_expired.
   */
  async claimRequests({ limit }) {
    const body = await this.#send('POST', `/api/v1/host/${this.hostKey}/provider/claim`, { limit, projectId: this.projectId });
    return checkedClaim(body);
  }

  /**
   * Post the answer to one claimed request. `hostKey` travels in the BODY: the service accepts a result only from
   * the host holding the claim. `ok` is always a real boolean, and the absent parts are explicit nulls.
   */
  async postResult(requestId, { ok, value = null, problem = null, provenance = null }) {
    return this.#send('POST', `/api/v1/provider/requests/${encodeURIComponent(requestId)}/result`, {
      hostKey: this.hostKey, ok: ok === true, value, problem, provenance,
    });
  }

  /**
   * The anchors this project watches, and the revision they were read at.
   *
   * ⛔ THE REVISION MUST TRAVEL WITH THE ITEMS AND BE SENT BACK UNCHANGED. It is a compare-and-set: the
   * service refuses a batch computed against a set that has since moved, because a mark for an anchor that
   * has been deleted names a target no document holds — visible nowhere, clearable by nobody.
   */
  async readWatchSet() {
    const body = await this.#send('GET', this.#watchSetPath, undefined);
    return {
      watchRevision: body.watchRevision,
      items: body.items ?? [],
      graphs: body.graphs ?? [],
    };
  }

  /**
   * Post one complete batch. Throws `SignalsRefused` on anything but a 2xx.
   *
   * ⛔ `reporterId` IS REQUIRED IN THE BODY, and only the route says so. `WatchSignals.apply` takes it as a
   * parameter, which tells you nothing about where it comes from; `routes/provider.ts:224` is the line that
   * reads `required(raw, "reporterId")`. Omitting it is a 400 before any of the seam's own reasoning runs —
   * found by reading the handler the request actually reaches rather than the class it calls. READ THE
   * ARTIFACT THE OPERATION WILL USE.
   *
   * ⚠ And note it is SELF-DECLARED. `reconfirm` derives its actor from `whoAsked(context.principal)`, the
   * authenticated key; signals takes the reporter's name from the request body, so any valid agent key may
   * report under any name. Raised with them rather than worked around: the weaker provenance is on the path
   * that WRITES marks.
   */
  /**
   * Take a new baseline for ONE anchor. Throws `SignalsRefused` on anything but a 2xx.
   *
   * ⛔ ONE ANCHOR, NAMED BY THE CALLER, AND NEVER CALLED BY A SWEEP. Reconfirm is one of only two acts the
   * service allows to SETTLE a mark, and its design calls it "a deliberate act by something that looked". A
   * sweep that reconfirmed what it had just reported would clear its own marks in the same breath. So this
   * method takes exactly one watchId, and the only caller is an entry point that requires the operator to name
   * each anchor (`scripts/reconfirm-anchor.mjs`). There is no "reconfirm all".
   *
   * The stamp must carry `hash`, `stampVersion` AND `commit` — `watch.ts stampFrom` refuses a stamp missing any
   * of them as `bad_stamp`, because a baseline with no commit cannot say what it was taken against.
   */
  async reconfirm({ watchId, watchRevision, stamp }) {
    return this.#send('POST', this.#reconfirmPath, { watchId, watchRevision, stamp });
  }

  async postSignals({ head, watchRevision, results, unwatched, sweep }) {
    return this.#send('POST', this.#signalsPath, {
      reporterId: this.reporterId, head, watchRevision, results, unwatched,
      // ⛔ OMITTED, not null, when there is no sweep: the service reads `sweep: null` as a malformed sweep.
      ...(sweep === undefined ? {} : { sweep: { id: sweep.id, predecessor: sweep.predecessor } }),
    });
  }

  async #send(method, path, payload) {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'x-api-key': this.#apiKey,
        // ⛔ WITHOUT THIS, A RECONFIRM IS RECORDED AS "an agent". The key admits the request as kind `agent`, and
        // `whoAsked` (routes/provider.ts:301) names the actor from this header or falls back to the anonymous
        // "an agent". It is a CLAIM, not an identity — one shared key authenticates every agent — but a named
        // claim beside the body's `reporterId` makes the two comparable instead of leaving one blank.
        'x-aify-agent': this.reporterId,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    // ⚠ Read the body BEFORE branching on status. A refusal carries the message that says what to do about
    // it, and a client that throws on the status alone throws away the only useful part.
    const text = await response.text();
    let body = null;
    try {
      body = text === '' ? null : JSON.parse(text);
    } catch {
      body = { message: `response was not JSON: ${text.slice(0, 300)}` };
    }
    if (!response.ok) throw new SignalsRefused(response.status, body);
    return body;
  }
}
