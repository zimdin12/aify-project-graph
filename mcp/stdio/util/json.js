// P5-1: Pre-parse JSON size cap (memory-bomb guard).
//
// Reading `.aify-graph/*.json` (brief.json, functionality.json,
// manifest.json, unresolved-categorization.json, …) via
// `JSON.parse(readFileSync(...))` with no size check risks OOM on a
// corrupt or maliciously huge file — `readFileSync` buffers the whole
// thing and `JSON.parse` then doubles the resident set while building the
// object graph. This helper stat-checks the file size FIRST and refuses to
// read anything over the cap, so a 4 GB `manifest.json` fails fast with a
// clear error instead of taking the process down.
//
// Default cap: 64 MiB. Real graph artifacts are typically KBs–low MBs;
// even a large brief.json on a big monorepo stays well under this. Override
// per-call via `{ maxBytes }`, or globally via `APG_JSON_MAX_BYTES` (bytes).
//
// Two shapes so callers can keep their existing return contracts:
//   - readJsonCapped(path, opts)      → throws on over-cap / parse error
//   - readJsonCappedSafe(path, opts)  → returns null on any failure
//
// Both are no-throw on the "file missing" case unless `mustExist` is set;
// they mirror the lenient try/catch most existing callers already wrap the
// read in.

import { readFileSync, statSync } from 'node:fs';

export const DEFAULT_JSON_MAX_BYTES = 64 * 1024 * 1024; // 64 MiB

function resolveCap(maxBytes, env) {
  if (Number.isFinite(maxBytes) && maxBytes > 0) return maxBytes;
  const fromEnv = Number(env?.APG_JSON_MAX_BYTES);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return DEFAULT_JSON_MAX_BYTES;
}

export class JsonTooLargeError extends Error {
  constructor(path, size, cap) {
    super(`JSON file too large: ${path} is ${size} bytes (cap ${cap} bytes). Refusing to parse to avoid OOM; raise APG_JSON_MAX_BYTES or pass { maxBytes } if this is legitimate.`);
    this.name = 'JsonTooLargeError';
    this.code = 'JSON_TOO_LARGE';
    this.path = path;
    this.size = size;
    this.cap = cap;
  }
}

/**
 * Size-capped JSON read. Stats the file first; if it exceeds the cap, throws
 * a JsonTooLargeError WITHOUT reading the bytes. Otherwise reads + parses.
 *
 * @param {string} path
 * @param {object} [opts]
 * @param {number} [opts.maxBytes]  byte cap (default 64 MiB / APG_JSON_MAX_BYTES)
 * @param {boolean} [opts.mustExist] when false (default), a missing file
 *   returns `null` instead of throwing ENOENT.
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {any} parsed JSON, or null if the file is missing and !mustExist.
 */
export function readJsonCapped(path, { maxBytes, mustExist = false, env = process.env } = {}) {
  const cap = resolveCap(maxBytes, env);
  let size;
  try {
    size = statSync(path).size;
  } catch (err) {
    if (err?.code === 'ENOENT' && !mustExist) return null;
    throw err;
  }
  if (size > cap) throw new JsonTooLargeError(path, size, cap);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Lenient variant: returns null on ANY failure (missing, over-cap, parse
 * error). For callers that already degrade gracefully on bad JSON and only
 * want the size guard added without changing control flow.
 *
 * @returns {{ ok: true, value: any } | { ok: false, error: Error }}
 *   when `detailed` is true; otherwise the parsed value or null.
 */
export function readJsonCappedSafe(path, opts = {}) {
  const { detailed = false, ...rest } = opts;
  try {
    const value = readJsonCapped(path, rest);
    return detailed ? { ok: true, value } : value;
  } catch (error) {
    return detailed ? { ok: false, error } : null;
  }
}
