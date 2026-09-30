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
    super(`${code}: ${body?.message ?? 'no message'}`);
    this.name = 'SignalsRefused';
    this.status = status;
    this.code = code;
    this.body = body;
    // ⛔ A STALE REVISION IS THE ONE REFUSAL WITH A CORRECT AUTOMATIC RESPONSE — re-read and recompute. Named
    // as a flag rather than left for the caller to string-match, because a string match on a message is a
    // check that breaks when the wording improves.
    this.shouldReread = status === 409 || code === 'stale_watch_revision';
  }
}

export class DashboardSignalsClient {
  #apiKey;

  constructor({ baseUrl, apiKey, hostKey, projectId, reporterId = 'aify-project-graph', fetchImpl = fetch }) {
    if (!baseUrl || !hostKey || !projectId) {
      throw new Error('DashboardSignalsClient needs a baseUrl, a hostKey and a projectId');
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

  async postSignals({ head, watchRevision, results, unwatched }) {
    return this.#send('POST', this.#signalsPath, {
      reporterId: this.reporterId, head, watchRevision, results, unwatched,
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
