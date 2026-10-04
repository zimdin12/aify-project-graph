// Live LSP session manager — keeps a long-running LspClient per (language,
// projectRoot) so bounded inner-loop verbs (code_intel_references, etc.)
// don't pay clangd startup tax on every call. Singleton-per-key inside the
// MCP server process. A session unused for the idle window (APG_LSP_IDLE_MS, default 10 min) is shut down.
//
// Reference-pattern parity: matches agent-code-intel's "bounded clients on
// demand" — APG owns the lifecycle; hosts target one stable wrapper command.

import { pathToFileURL } from 'node:url';
import { LspClient } from './lsp-client.js';
import { getBackend, normalizeLanguage } from './backends.js';

const SESSIONS = new Map();
// In-flight start promises, keyed the same as SESSIONS. Audit 2026-06-12: two
// concurrent verb calls for the same (language, projectRoot) both awaited
// client.start() and both SESSIONS.set — the loser's spawned server was
// overwritten in the map and never shut down (leaked clangd/tsserver/pyright).
// Dedup by parking concurrent callers on the first start's promise.
const STARTING = new Map();

function keyFor(language, projectRoot) { return `${language}:::${projectRoot}`; }

// ⛔ A LANGUAGE SERVER NOBODY IS USING IS SHUT DOWN. Sessions used to live until the MCP server exited. Measured
// 2026-10-04: three sessions on one C++ repo held 3 clangds (3.01 GB) after 120 idle seconds, and a clangd that
// exits gives its memory back. How long "unused" is depends on the machine, so it comes from configuration.
export const DEFAULT_IDLE_MS = 10 * 60_000;

/** The idle window: APG_LSP_IDLE_MS when it is a positive number, the default otherwise. PURE. */
export function idleMsFrom(env = process.env) {
  const n = Number(env?.APG_LSP_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_IDLE_MS;
}

// (Re)starts a session's idle timer. When it fires, a session with a request still in flight gets a fresh window
// instead, because shutting a server down under a caller would turn its answer into an error. The timer does not
// keep the process alive.
function armIdle(key, session) {
  clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    if (SESSIONS.get(key) !== session) return;
    if (session.client.pending?.size > 0) { armIdle(key, session); return; }
    SESSIONS.delete(key);
    session.client.shutdown().catch(() => { /* already gone */ });
  }, idleMsFrom());
  session.idleTimer.unref?.();
}

/**
 * Acquire (or start) a live LSP session for a language + project.
 * Options:
 *   spawn: { command, args } — override (used by tests with a fake LSP).
 */
export async function getLiveSession({ language, projectRoot, spawn } = {}) {
  if (!language || !projectRoot) throw new Error('getLiveSession: language and projectRoot required');
  const lang = normalizeLanguage(language);
  const key = keyFor(lang, projectRoot);
  const existing = SESSIONS.get(key);
  // A crashed/exited client must never be handed back — evict and re-spawn.
  if (existing && !existing.client.dead) { armIdle(key, existing); return existing; }
  if (existing) SESSIONS.delete(key);

  const inflight = STARTING.get(key);
  if (inflight) return inflight;

  let spawnCfg = spawn;
  let timeoutMs;
  if (!spawnCfg) {
    const backend = getBackend(lang);
    if (backend) {
      spawnCfg = backend.spawnFor(projectRoot);
      timeoutMs = backend.coldTimeoutMs;
    }
  }
  if (!spawnCfg) {
    const err = new Error(`no language server registered for '${language}'`);
    err.code = 'language_unsupported';
    throw err;
  }

  const startPromise = (async () => {
    const client = new LspClient({
      ...spawnCfg,
      rootUri: pathToFileURL(projectRoot).toString(),
      ...(timeoutMs ? { timeoutMs } : {})
    });
    // `warmedOnce` flips after the first diagnostics batch so cold sessions
    // get one longer warm-up (reference parity: cold servers return empty
    // first-call diagnostics) and warm sessions stay low-latency.
    // Plan #14 Step D: sticky degraded-references state per session.
    // Once references comes back degraded (cold_index, timeout, etc.) we
    // remember the cause until a later ready+exhaustive result clears it.
    // Subsequent technically-clean results in the degraded window carry a
    // warning so an agent doesn't bump confidence prematurely.
    const session = { language: lang, projectRoot, client, openedUris: new Set(), warmedOnce: false, referencesStickyDegraded: null };
    try {
      await client.start();
    } catch (err) {
      // Review-fix #2: preserve the binary name + original errno so the
      // error response upstream can render an actionable hint ("clangd not
      // on PATH; install via …") instead of a generic "language_server_
      // missing." The original ENOENT carries err.path = the binary name
      // and err.code = 'ENOENT' / 'EACCES' / etc.
      const binary = err?.path ?? spawnCfg?.command ?? language;
      const wrapped = new Error(`language_server_missing: ${binary} (${err?.code ?? 'spawn failed'}) — ${err?.message ?? ''}`.trim());
      wrapped.code = 'language_server_missing';
      wrapped.binary = binary;
      wrapped.originalCode = err?.code ?? null;
      wrapped.cause = err;
      throw wrapped;
    }
    SESSIONS.set(key, session);
    armIdle(key, session);
    // Self-evict on crash/exit so a dead session is never returned and the next
    // call re-spawns cleanly (client.dead is also checked above as a backstop).
    client.once('exit', () => { if (SESSIONS.get(key) === session) SESSIONS.delete(key); });
    return session;
  })();

  STARTING.set(key, startPromise);
  try {
    return await startPromise;
  } finally {
    STARTING.delete(key);
  }
}

export async function shutdownAllSessions() {
  for (const session of SESSIONS.values()) {
    clearTimeout(session.idleTimer);
    try { await session.client.shutdown(); } catch { /* ignore */ }
  }
  SESSIONS.clear();
}

export function _resetSessions() {
  for (const session of SESSIONS.values()) clearTimeout(session.idleTimer);
  SESSIONS.clear();
}
