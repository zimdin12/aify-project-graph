// Live LSP session manager — keeps a long-running LspClient per (language,
// projectRoot) so bounded inner-loop verbs (code_intel_references, etc.)
// don't pay clangd startup tax on every call. Singleton-per-key inside the
// MCP server process; idle sessions can be torn down later if needed.
//
// Reference-pattern parity: matches agent-code-intel's "bounded clients on
// demand" — APG owns the lifecycle; hosts target one stable wrapper command.

import { pathToFileURL } from 'node:url';
import { LspClient } from './lsp-client.js';

const SESSIONS = new Map();

function keyFor(language, projectRoot) { return `${language}:::${projectRoot}`; }

const LANGUAGE_SPAWN = {
  cpp: { command: 'clangd', args: ['--background-index=false'] }
};

/**
 * Acquire (or start) a live LSP session for a language + project.
 * Options:
 *   spawn: { command, args } — override (used by tests with a fake LSP).
 */
export async function getLiveSession({ language, projectRoot, spawn } = {}) {
  if (!language || !projectRoot) throw new Error('getLiveSession: language and projectRoot required');
  const key = keyFor(language, projectRoot);
  const existing = SESSIONS.get(key);
  if (existing) return existing;

  const spawnCfg = spawn || LANGUAGE_SPAWN[language];
  if (!spawnCfg) {
    const err = new Error(`no language server registered for '${language}'`);
    err.code = 'language_unsupported';
    throw err;
  }

  const client = new LspClient({ ...spawnCfg, rootUri: pathToFileURL(projectRoot).toString() });
  // `warmedOnce` flips after the first diagnostics batch so cold sessions
  // get one longer warm-up (reference parity: cold servers return empty
  // first-call diagnostics) and warm sessions stay low-latency.
  // Plan #14 Step D: sticky degraded-references state per session.
  // Once references comes back degraded (cold_index, timeout, etc.) we
  // remember the cause until a later ready+exhaustive result clears it.
  // Subsequent technically-clean results in the degraded window carry a
  // warning so an agent doesn't bump confidence prematurely.
  const session = { language, projectRoot, client, openedUris: new Set(), warmedOnce: false, referencesStickyDegraded: null };
  try {
    await client.start();
  } catch (err) {
    const wrapped = new Error(`language_server_missing: ${err.message}`);
    wrapped.code = 'language_server_missing';
    throw wrapped;
  }
  SESSIONS.set(key, session);
  return session;
}

export async function shutdownAllSessions() {
  for (const session of SESSIONS.values()) {
    try { await session.client.shutdown(); } catch { /* ignore */ }
  }
  SESSIONS.clear();
}

export function _resetSessions() { SESSIONS.clear(); }
