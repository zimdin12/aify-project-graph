import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { hostToWsl, wslToHost } from './compile-db.js';

// ── WSL-clangd URI translation (opt-in APG_CLANGD_WSL) ─────────────────────
//
// When clangd runs UNDER WSL, it speaks Linux file URIs (`file:///mnt/c/...`).
// The rest of APG works in Windows paths and builds Windows URIs
// (`file:///C:/...`). So at the stdio boundary we translate:
//   - OUTGOING (host → WSL): every `file:///C:/...` URI we send becomes
//     `file:///mnt/c/...` so clangd matches the Linux DB entries.
//   - INCOMING (WSL → host): every `file:///mnt/c/...` URI clangd returns
//     becomes `file:///C:/...` so locations resolve to Windows paths before
//     they reach the provider/agent/importer.
// rootUri is translated once at construction; the rest is done generically by
// walking every JSON message (URIs appear in definition/references/hover/
// hierarchy/diagnostics under different shapes — a generic walk covers them all
// without per-method plumbing). On the default (Windows) transport pathMode is
// undefined and these are exact no-ops.

const FILE_URI_PREFIX = 'file://';

// Canonicalize a `file://` URI for stable map keying. Audit 2026-06-12: we build
// diagnostic keys with Node's pathToFileURL (`file:///C:/...`) but
// typescript-language-server / pyright (vscode-uri) PUBLISH them as
// `file:///c%3A/...` (lowercase drive, percent-encoded colon). Keyed verbatim,
// every diagnostics lookup on Windows missed → waitForDiagnostics always timed
// out (1.5–3s tax per file) and the hierarchy cold-parse gate never saw a
// publish. Round-trip through the OS path (decodes %3A) then lowercase the drive
// letter so `C:` and `c:` collapse to one key. Non-file / unparseable URIs and
// posix paths pass through unchanged (round-trip is a stable no-op there).
export function canonicalUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith(FILE_URI_PREFIX)) return uri;
  try {
    const round = pathToFileURL(fileURLToPath(uri)).toString();
    return round.replace(/^(file:\/\/\/)([A-Za-z]):/, (_, p, d) => `${p}${d.toLowerCase()}:`);
  } catch {
    return uri;
  }
}

// Translate a single `file://` URI. `dir` is 'out' (host→WSL) or 'in'
// (WSL→host). Pure + exported for direct unit testing.
export function translateUri(uri, dir) {
  if (typeof uri !== 'string' || !uri.startsWith(FILE_URI_PREFIX)) return uri;
  // Strip scheme; clangd emits `file:///mnt/c/...` (host has the leading `/`).
  let body = uri.slice(FILE_URI_PREFIX.length);
  // Decode percent-encoding so the path matcher sees real chars (spaces etc.),
  // then re-encode minimally on the way out is unnecessary — clangd and Node's
  // fileURLToPath both tolerate the decoded path for our drive-letter case.
  const hadLeadingSlash = body.startsWith('/');
  const path = hadLeadingSlash ? body.slice(1) : body;
  let decoded = path;
  try { decoded = decodeURIComponent(path); } catch { /* leave as-is */ }
  if (dir === 'out') {
    // host → WSL. A Windows URI body is `/C:/Users/...` (leading slash + drive).
    const mapped = hostToWsl(decoded);
    // WSL absolute path: `file://` + the absolute posix path (single scheme
    // slashes, then the path's own leading `/`).
    return FILE_URI_PREFIX + mapped;
  }
  // dir === 'in'. WSL → host. body is `/mnt/c/...` (posix abs w/ leading slash).
  const posix = hadLeadingSlash ? '/' + decoded : decoded;
  const host = wslToHost(posix); // `/mnt/c/x` → `C:/x` on win32
  if (host !== posix) {
    // Re-emit as a Windows file URI: `file:///C:/x`.
    return `${FILE_URI_PREFIX}/${host}`;
  }
  return uri;
}

// Recursively rewrite every `uri` (and `rootUri`/`targetUri`) string field in a
// JSON-RPC message. Mutates a structural copy; returns it. dir as above.
function rewriteUris(node, dir) {
  if (node == null) return node;
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = rewriteUris(node[i], dir);
    return node;
  }
  if (typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (typeof v === 'string' && v.startsWith(FILE_URI_PREFIX)
          && (k === 'uri' || k === 'rootUri' || k === 'targetUri')) {
        node[k] = translateUri(v, dir);
      } else if (v && typeof v === 'object') {
        rewriteUris(v, dir);
      }
    }
    return node;
  }
  return node;
}

export class LspClient extends EventEmitter {
  constructor({ command, args = [], cwd, env, rootUri, timeoutMs = 10000, pathMode } = {}) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    // pathMode === 'wsl' activates host↔WSL URI translation at the boundary.
    this.pathMode = pathMode;
    // rootUri is host-shaped on the way in; translate it once for the WSL
    // transport so clangd's workspace root is a Linux path too.
    this.rootUri = (pathMode === 'wsl' && rootUri) ? translateUri(rootUri, 'out') : (rootUri || `file:///`);
    this.timeoutMs = timeoutMs;
    this.proc = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.pending = new Map();
    this.diagnosticsByUri = new Map();
    this.diagnosticPublishCounts = new Map();
    this.diagnosticWaiters = new Map();
    this.readyWaiters = new Set();
    this.progressTokens = new Set();
    this.indexingState = 'unknown';
    // Plan #14 Step B: workspace-warm evidence counter. Distinguishes
    // 'cold' (zero files opened in this session — no readiness possible)
    // from 'unknown' (older adapter can't classify) and from 'fresh'
    // (warmed + ready signal). Increments per successful didOpen.
    this.workspaceWarmCount = 0;
    this.started = false;
    // Flips true when the child process exits/crashes. A dead client must not be
    // reused (live.js evicts it) and _send must not write to its destroyed pipe.
    this.dead = false;
    // P5-3: parent-liveness poll. A long-lived clangd child spawned below can
    // outlive a HARD-killed parent (kill -9 leaves no chance to run shutdown),
    // leaking the process plus its file watches / on-disk index WAL. We record
    // the parent pid at start and poll it; if the parent dies we shut the child
    // down ourselves. Cheap (one process.kill(pid,0) per interval), cleared on
    // normal shutdown, and opt-outable via APG_PPID_POLL_MS=0.
    this._ppidPollTimer = null;
    this._initialPpid = null;
  }

  // Start a lightweight poll that shuts this client's child process down if
  // the parent process dies. Default interval 5s; APG_PPID_POLL_MS overrides,
  // and APG_PPID_POLL_MS=0 disables. `env`/`onOrphaned` are injectable so the
  // behaviour is unit-testable without spawning a real parent.
  _startPpidPoll({ env = process.env, onOrphaned } = {}) {
    const raw = env?.APG_PPID_POLL_MS;
    const intervalMs = raw === undefined ? 5000 : Number(raw);
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return; // disabled / invalid → opt-out
    this._initialPpid = typeof process.ppid === 'number' ? process.ppid : null;
    const isParentAlive = () => {
      // On POSIX a reaped parent reparents us to init (ppid → 1) and the
      // original ppid is gone. On any platform, kill(pid, 0) throwing ESRCH
      // means the process no longer exists. Treat ppid flipping to 1 (when it
      // didn't start there) as orphaned too, so we don't wait for the pid to
      // be recycled.
      const currentPpid = typeof process.ppid === 'number' ? process.ppid : null;
      if (this._initialPpid && this._initialPpid !== 1 && currentPpid === 1) return false;
      if (this._initialPpid == null) return true; // can't tell — assume alive
      try {
        process.kill(this._initialPpid, 0);
        return true;
      } catch (err) {
        // EPERM means the process exists but we can't signal it → still alive.
        return err?.code === 'EPERM';
      }
    };
    const tick = () => {
      if (this._ppidPollTimer == null) return;
      if (isParentAlive()) return;
      this._stopPpidPoll();
      if (typeof onOrphaned === 'function') { try { onOrphaned(); } catch { /* swallow */ } }
      // Best-effort self-shutdown; don't await (timer context).
      try { this.shutdown(); } catch { /* swallow */ }
    };
    this._ppidPollTimer = setInterval(tick, intervalMs);
    if (typeof this._ppidPollTimer.unref === 'function') this._ppidPollTimer.unref();
  }

  _stopPpidPoll() {
    if (this._ppidPollTimer != null) {
      clearInterval(this._ppidPollTimer);
      this._ppidPollTimer = null;
    }
  }

  async start() {
    this.proc = spawn(this.command, this.args, { cwd: this.cwd, env: this.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    // Review-fix #1: Node's child_process emits ENOENT on the spawn 'error'
    // event ASYNCHRONOUSLY after spawn() returns. Without an early listener
    // racing the initialize request, the error fires past getLiveSession's
    // try/catch — propagating to uncaughtException and crashing scripts that
    // treat verb returns as terminal. Listen for the early error and reject
    // the start() promise with a structured error (code/path preserved so
    // the calling layer can wrap it into language_server_missing without
    // dropping the source information).
    let spawnRejected = false;
    const earlySpawnError = new Promise((_, reject) => {
      const onErr = (err) => {
        spawnRejected = true;
        this.proc.off('error', onErr);
        reject(err);
      };
      this.proc.once('error', onErr);
    });
    // After start() succeeds, switch to the original re-emit-only handler so
    // post-init errors still bubble through the EventEmitter interface that
    // existing consumers expect.
    earlySpawnError.catch(() => { /* swallow uncaught rejection — caller will rethrow */ });

    this.proc.stdout.on('data', chunk => this._onData(chunk));
    this.proc.stderr.on('data', chunk => this.emit('stderr', chunk.toString('utf8')));
    // A write to a dead child's stdin (server crashed) surfaces as an unhandled
    // 'error' (EPIPE / ERR_STREAM_DESTROYED) that would take down the whole MCP
    // process. Sink it — _send guards on this.dead and _onProcExit cleans up.
    this.proc.stdin.on('error', () => { /* server gone; handled by exit */ });
    this.proc.on('exit', code => this._onProcExit(code));
    // NOTE: the post-init re-emit of 'error' on this LspClient is deferred
    // until after start() resolves (below). Attaching it here would race
    // the early listener — both would fire on ENOENT, and the
    // this.emit('error', ...) call would bubble to uncaughtException since
    // nothing subscribes to LspClient's 'error' event.

    const initPromise = this._request('initialize', {
      processId: process.pid,
      rootUri: this.rootUri,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didClose: true },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          hover: { dynamicRegistration: false, contentFormat: ['markdown', 'plaintext'] },
          documentSymbol: { dynamicRegistration: false },
          // L4: declare call/type hierarchy so clangd advertises
          // callHierarchyProvider / typeHierarchyProvider in its
          // serverCapabilities and answers prepare/incoming/outgoing +
          // prepare/subtypes/supertypes requests.
          callHierarchy: { dynamicRegistration: false },
          typeHierarchy: { dynamicRegistration: false },
          publishDiagnostics: {},
          diagnostic: {}
        },
        window: {
          workDoneProgress: true
        }
      }
    });

    let initResult;
    try {
      initResult = await Promise.race([initPromise, earlySpawnError]);
    } catch (err) {
      // ENOENT (or any other spawn-level error) wins the race. Preserve
      // err.code and err.path so the wrap site (getLiveSession in live.js)
      // can propagate language_server_missing with the binary name attached.
      throw err;
    }
    if (spawnRejected) {
      // Defensive — should be unreachable since Promise.race already threw.
      throw new Error('LspClient.start: spawn rejected after race resolved');
    }
    // Post-init: now safe to install the re-emit handler. Attach a no-op
    // listener on LspClient's 'error' event so EventEmitter doesn't throw
    // if a post-init spawn error fires without any external consumer (the
    // pending request promise will already reject via _onData/timeout
    // semantics; the proc-level error is just a notification).
    this.on('error', () => { /* noop sink so post-init errors don't crash */ });
    this.proc.on('error', err => this.emit('error', err));
    this._notify('initialized', {});
    this.serverCapabilities = initResult?.capabilities || {};
    this.started = true;
    // P5-3: begin the parent-liveness poll now that the child is live.
    this._startPpidPoll();
    return initResult;
  }

  // Child exited/crashed. Audit 2026-06-12: previously the only handler
  // re-emitted 'exit' and left every in-flight request hanging its full
  // timeout (45s for cpp live sessions) while live.js kept the dead session
  // cached so the next verb _send'd into a destroyed pipe. Now: mark dead,
  // stop the poll, and reject all pending so callers fail fast.
  _onProcExit(code) {
    this.dead = true;
    this.started = false;
    this._stopPpidPoll();
    for (const p of this.pending.values()) {
      try { p.reject(new Error(`LSP server exited (code ${code}) before responding`)); } catch { /* noop */ }
    }
    this.pending.clear();
    this.emit('exit', code);
  }

  async shutdown() {
    // Always clear the orphan poll first — even on a no-op shutdown — so the
    // interval can't keep the process alive or fire after teardown.
    this._stopPpidPoll();
    if (!this.started) return;
    try {
      await this._request('shutdown', null);
      this._notify('exit', null);
    } catch { /* swallow */ }
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill(); } catch { /* ignore */ }
    }
    this.started = false;
  }

  async didOpen(uri, languageId, text, version = 1) {
    this.workspaceWarmCount += 1;
    return this._notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text }
    });
  }

  async didClose(uri) {
    return this._notify('textDocument/didClose', { textDocument: { uri } });
  }

  // Full-sync document update. Audit 2026-06-12 B2: long-lived sessions kept the
  // first-opened text forever, so after an on-disk edit the server answered
  // against stale content (drifted lines; "exhaustive" results on code that no
  // longer exists). Re-sends the whole file (textDocumentSync: Full).
  async didChange(uri, text, version = 2) {
    return this._notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  async references(uri, position, includeDeclaration = false) {
    return this._request('textDocument/references', {
      textDocument: { uri }, position, context: { includeDeclaration }
    });
  }

  async definition(uri, position) {
    return this._request('textDocument/definition', { textDocument: { uri }, position });
  }

  async hover(uri, position) {
    return this._request('textDocument/hover', { textDocument: { uri }, position });
  }

  async documentSymbol(uri) {
    return this._request('textDocument/documentSymbol', { textDocument: { uri } });
  }

  // L4 — Call hierarchy (LSP 3.16). prepareCallHierarchy resolves the symbol at
  // a position to one or more CallHierarchyItem{name,kind,uri,range,selectionRange,...}.
  // Those items are then fed to incomingCalls/outgoingCalls to walk the tree.
  async prepareCallHierarchy(uri, position) {
    return this._request('textDocument/prepareCallHierarchy', { textDocument: { uri }, position });
  }

  // incomingCalls → who calls `item` (callers). Returns
  // [{ from: CallHierarchyItem, fromRanges: Range[] }].
  async incomingCalls(item) {
    return this._request('callHierarchy/incomingCalls', { item });
  }

  // outgoingCalls → what `item` calls (callees). Returns
  // [{ to: CallHierarchyItem, fromRanges: Range[] }].
  async outgoingCalls(item) {
    return this._request('callHierarchy/outgoingCalls', { item });
  }

  // L4 — Type hierarchy (LSP 3.17). prepareTypeHierarchy resolves the type at a
  // position to one or more TypeHierarchyItem; subtypes/supertypes walk the
  // virtual-override / inheritance set.
  async prepareTypeHierarchy(uri, position) {
    return this._request('textDocument/prepareTypeHierarchy', { textDocument: { uri }, position });
  }

  // typeHierarchySubtypes → derived types / overriding implementations of `item`.
  async typeHierarchySubtypes(item) {
    return this._request('typeHierarchy/subtypes', { item });
  }

  // typeHierarchySupertypes → base types of `item`.
  async typeHierarchySupertypes(item) {
    return this._request('typeHierarchy/supertypes', { item });
  }

  supportsCallHierarchy() {
    return Boolean(this.serverCapabilities?.callHierarchyProvider);
  }

  supportsTypeHierarchy() {
    return Boolean(this.serverCapabilities?.typeHierarchyProvider);
  }

  diagnosticsFor(uri) {
    return this.diagnosticsByUri.get(canonicalUri(uri)) || [];
  }

  async diagnosticsForWithFreshness(uri, waitMs = 1500, { sincePublishCount = null, force = true } = {}) {
    return this.diagnostics(uri, waitMs, { sincePublishCount, force });
  }

  async diagnostics(uri, waitMs = 1500, { sincePublishCount = null, force = true } = {}) {
    // NB: cache lookups canonicalize the URI internally (helpers below), but the
    // ORIGINAL uri is what we send to the server — it opened the doc under the
    // caller's form, so requests must use it verbatim.
    if (this.supportsPullDiagnostics()) {
      return this.pullDiagnostics(uri, { force });
    }

    const publishCount = sincePublishCount ?? this.diagnosticPublishCount(uri);
    const observedFreshPublish = await this.waitForDiagnostics(uri, publishCount, waitMs);
    if (observedFreshPublish) {
      return { freshness: 'fresh', diagnostics: this.diagnosticsFor(uri) };
    }

    if (this.diagnosticsByUri.has(canonicalUri(uri))) {
      return { freshness: 'stale', diagnostics: this.diagnosticsFor(uri) };
    }

    return { freshness: 'timeout', diagnostics: [] };
  }

  async pullDiagnostics(uri, { force = true } = {}) {
    const key = canonicalUri(uri);
    if (!force && this.diagnosticsByUri.has(key)) {
      return { freshness: 'stale', diagnostics: this.diagnosticsFor(uri) };
    }

    // Send the caller's original uri — the server keys the document by it.
    const result = await this._request('textDocument/diagnostic', {
      textDocument: { uri }
    });
    const diagnostics = Array.isArray(result?.items) ? result.items : this.diagnosticsFor(uri);
    this.diagnosticsByUri.set(key, diagnostics);
    return { freshness: 'fresh', diagnostics };
  }

  supportsPullDiagnostics() {
    return Boolean(this.serverCapabilities?.diagnosticProvider);
  }

  diagnosticPublishCount(uri) {
    return this.diagnosticPublishCounts.get(canonicalUri(uri)) || 0;
  }

  waitForDiagnostics(uri, sincePublishCount, waitMs) {
    uri = canonicalUri(uri);
    if (this.diagnosticPublishCount(uri) > sincePublishCount) {
      return Promise.resolve(true);
    }

    if (waitMs <= 0) {
      return Promise.resolve(false);
    }

    return new Promise(resolve => {
      const waiter = {
        sincePublishCount,
        resolve,
        timer: setTimeout(() => {
          this._removeDiagnosticWaiter(uri, waiter);
          resolve(false);
        }, waitMs)
      };
      const waiters = this.diagnosticWaiters.get(uri) || [];
      waiters.push(waiter);
      this.diagnosticWaiters.set(uri, waiters);
    });
  }

  _removeDiagnosticWaiter(uri, waiter) {
    uri = canonicalUri(uri);
    const waiters = this.diagnosticWaiters.get(uri);
    if (!waiters) return;
    const remaining = waiters.filter(w => w !== waiter);
    if (remaining.length === 0) this.diagnosticWaiters.delete(uri);
    else this.diagnosticWaiters.set(uri, remaining);
  }

  navigationFreshness() {
    // Plan #14 Step B: 4-state model. `cold` is explicit "no workspace
    // file has been opened in this session yet" — distinct from `unknown`
    // (server hasn't emitted a readiness signal we could classify).
    // `fresh` requires BOTH ready-signal AND actual workspace warm.
    if (this.indexingState === 'indexing') return 'stale';
    if (this.workspaceWarmCount === 0) return 'cold';
    if (this.indexingState === 'ready') return 'fresh';
    return 'unknown';
  }

  waitForReady(timeoutMs = 0) {
    const freshness = this.navigationFreshness();
    if (freshness === 'fresh' || timeoutMs <= 0) {
      return Promise.resolve(freshness);
    }

    return new Promise(resolve => {
      const waiter = {
        resolve,
        timer: setTimeout(() => {
          this.readyWaiters.delete(waiter);
          resolve(this.navigationFreshness());
        }, timeoutMs)
      };
      this.readyWaiters.add(waiter);
    });
  }

  // Code-Intel v2 FIX A: wait for clangd's background index to go idle before
  // issuing reference queries, so cross-TU callers are visible (otherwise
  // `references` races the index and returns not_found_after_retry).
  //
  // Resolves with { ready:boolean, waitMs:number, reason }. Bounded — never
  // hangs forever. Handles three real clangd timings:
  //   (1) index already on disk → no `$/progress` ever fires. We give it a
  //       short grace window (settleMs) for a `begin` to appear; if none does
  //       and at least one file is warmed, we treat the server as ready.
  //   (2) indexing in flight → resolves on the `$/progress end` that drains
  //       the last token (navigationFreshness() flips to 'fresh').
  //   (3) indexing never finishes within timeoutMs → resolves ready:false so
  //       the caller records indexReady:false and the banner says "not ready".
  async waitForIndexReady({ timeoutMs = 90000, settleMs = 1500 } = {}) {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;

    // Already fully ready (warmed + idle): done immediately.
    if (this.navigationFreshness() === 'fresh') {
      return { ready: true, waitMs: elapsed(), reason: 'already_ready' };
    }

    // Grace window: clangd may emit the `$/progress begin` a beat after
    // `initialized`/`didOpen`. Poll briefly for indexing to START. If it never
    // starts (index already on disk) and we've warmed files, call it ready.
    while (elapsed() < settleMs) {
      if (this.indexingState === 'indexing') break;
      if (this.navigationFreshness() === 'fresh') {
        return { ready: true, waitMs: elapsed(), reason: 'ready_no_index_needed' };
      }
      await new Promise(r => setTimeout(r, 50));
    }

    // If indexing never began and nothing is pending, the server is as ready
    // as it will get (no background work to wait on).
    if (this.indexingState !== 'indexing' && this.progressTokens.size === 0) {
      if (this.workspaceWarmCount > 0) {
        return { ready: true, waitMs: elapsed(), reason: 'no_progress_signalled' };
      }
      return { ready: false, waitMs: elapsed(), reason: 'cold_no_warm' };
    }

    // Indexing is in flight — wait for it to drain (or time out).
    const remaining = Math.max(0, timeoutMs - elapsed());
    const freshness = await this.waitForReady(remaining);
    const ready = freshness === 'fresh';
    return {
      ready,
      waitMs: elapsed(),
      reason: ready ? 'index_drained' : 'index_wait_timeout'
    };
  }

  _markIndexingStarted() {
    this.indexingState = 'indexing';
  }

  _markIndexingEnded() {
    this.indexingState = this.progressTokens.size > 0 ? 'indexing' : 'ready';
    this._resolveReadyWaiters();
  }

  _handleProgress(params = {}) {
    const kind = params.value?.kind;
    if (kind === 'begin') {
      this.progressTokens.add(params.token);
      this._markIndexingStarted();
      return;
    }
    if (kind === 'end') {
      this.progressTokens.delete(params.token);
      this._markIndexingEnded();
    }
  }

  _resolveReadyWaiters() {
    if (this.navigationFreshness() !== 'fresh') return;
    for (const waiter of this.readyWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve('fresh');
    }
    this.readyWaiters.clear();
  }

  _request(method, params) {
    const id = this.nextId++;
    const message = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request '${method}' timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this._send(message);
    });
  }

  _notify(method, params) {
    this._send({ jsonrpc: '2.0', method, params });
  }

  _send(message) {
    if (this.dead || !this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error('LSP client is not connected (server exited)');
    }
    // WSL transport: translate host file URIs → WSL before they reach clangd.
    // Work on a structural copy so callers' objects aren't mutated.
    let outgoing = message;
    if (this.pathMode === 'wsl') {
      outgoing = rewriteUris(JSON.parse(JSON.stringify(message)), 'out');
    }
    const json = JSON.stringify(outgoing);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.proc.stdin.write(header + json);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const len = parseInt(m[1], 10);
      if (this.buffer.length < headerEnd + 4 + len) return;
      const body = this.buffer.slice(headerEnd + 4, headerEnd + 4 + len).toString('utf8');
      this.buffer = this.buffer.slice(headerEnd + 4 + len);
      try {
        let parsed = JSON.parse(body);
        // WSL transport: translate WSL file URIs → host on EVERY inbound message
        // (request replies, publishDiagnostics notifications) so locations reach
        // the provider/agent as Windows paths.
        if (this.pathMode === 'wsl') parsed = rewriteUris(parsed, 'in');
        this._handle(parsed);
      } catch { /* swallow */ }
    }
  }

  _handle(msg) {
    if (msg.method === 'window/workDoneProgress/create' && msg.id !== undefined) {
      this._send({ jsonrpc: '2.0', id: msg.id, result: null });
      return;
    }

    if (msg.method === '$/progress') {
      this._handleProgress(msg.params);
      return;
    }

    if (msg.method === 'indexingStarted' || msg.method === 'intelephense/indexingStarted') {
      this._markIndexingStarted();
      return;
    }

    if (msg.method === 'indexingEnded' || msg.method === 'intelephense/indexingEnded') {
      this._markIndexingEnded();
      return;
    }

    // A RESPONSE has an id and no method; a server-initiated REQUEST has both.
    // Audit 2026-06-12: gating only on `pending.has(id)` conflated the two —
    // vscode-languageserver ids also start at 0/1, so a server request
    // (workspace/configuration, client/registerCapability, window/showMessageRequest)
    // could collide with an in-flight client id and resolve our pending promise
    // with `undefined`. Require method===undefined for the response branch.
    if (msg.id !== undefined && msg.method === undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'LSP error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = canonicalUri(msg.params?.uri);
      const diags = msg.params?.diagnostics || [];
      if (uri) {
        this.diagnosticsByUri.set(uri, diags);
        const publishCount = this.diagnosticPublishCount(uri) + 1;
        this.diagnosticPublishCounts.set(uri, publishCount);

        const remaining = [];
        for (const waiter of this.diagnosticWaiters.get(uri) || []) {
          if (publishCount > waiter.sincePublishCount) {
            clearTimeout(waiter.timer);
            waiter.resolve(true);
          } else {
            remaining.push(waiter);
          }
        }
        if (remaining.length === 0) this.diagnosticWaiters.delete(uri);
        else this.diagnosticWaiters.set(uri, remaining);
      }
      return;
    }
    // Unhandled server-initiated REQUEST (has id + method, not matched above).
    // Reply MethodNotFound so the server doesn't block waiting for a response
    // (an unanswered workspace/* or window/* request can stall pyright/tsserver).
    if (msg.id !== undefined && msg.method !== undefined) {
      this._send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `method not found: ${msg.method}` } });
    }
  }
}
