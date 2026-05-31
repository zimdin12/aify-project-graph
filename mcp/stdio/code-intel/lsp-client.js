import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

export class LspClient extends EventEmitter {
  constructor({ command, args = [], cwd, env, rootUri, timeoutMs = 10000 }) {
    super();
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.rootUri = rootUri || `file:///`;
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
    this.proc.on('exit', code => this.emit('exit', code));
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
    return initResult;
  }

  async shutdown() {
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
    return this.diagnosticsByUri.get(uri) || [];
  }

  async diagnosticsForWithFreshness(uri, waitMs = 1500, { sincePublishCount = null, force = true } = {}) {
    return this.diagnostics(uri, waitMs, { sincePublishCount, force });
  }

  async diagnostics(uri, waitMs = 1500, { sincePublishCount = null, force = true } = {}) {
    if (this.supportsPullDiagnostics()) {
      return this.pullDiagnostics(uri, { force });
    }

    const publishCount = sincePublishCount ?? this.diagnosticPublishCount(uri);
    const observedFreshPublish = await this.waitForDiagnostics(uri, publishCount, waitMs);
    if (observedFreshPublish) {
      return { freshness: 'fresh', diagnostics: this.diagnosticsFor(uri) };
    }

    if (this.diagnosticsByUri.has(uri)) {
      return { freshness: 'stale', diagnostics: this.diagnosticsFor(uri) };
    }

    return { freshness: 'timeout', diagnostics: [] };
  }

  async pullDiagnostics(uri, { force = true } = {}) {
    if (!force && this.diagnosticsByUri.has(uri)) {
      return { freshness: 'stale', diagnostics: this.diagnosticsFor(uri) };
    }

    const result = await this._request('textDocument/diagnostic', {
      textDocument: { uri }
    });
    const diagnostics = Array.isArray(result?.items) ? result.items : this.diagnosticsFor(uri);
    this.diagnosticsByUri.set(uri, diagnostics);
    return { freshness: 'fresh', diagnostics };
  }

  supportsPullDiagnostics() {
    return Boolean(this.serverCapabilities?.diagnosticProvider);
  }

  diagnosticPublishCount(uri) {
    return this.diagnosticPublishCounts.get(uri) || 0;
  }

  waitForDiagnostics(uri, sincePublishCount, waitMs) {
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
    const json = JSON.stringify(message);
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
      try { this._handle(JSON.parse(body)); } catch { /* swallow */ }
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

    if (msg.id !== undefined && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message || 'LSP error'));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'textDocument/publishDiagnostics') {
      const uri = msg.params?.uri;
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
    }
  }
}
