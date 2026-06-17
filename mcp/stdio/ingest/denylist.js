// Shared resolution denylist — the single source of truth for "targets the
// resolver refuses to resolve by design."
//
// COMMON_NAMES are bare short names (close/open/get/parse/log/…) that the
// resolver deliberately will NOT resolve: a single such name would otherwise
// fan out to hundreds of unrelated definitions across the repo, producing
// confident-but-wrong edges. JS_RUNTIME_GLOBALS are ambient JS/Node identifiers
// that have no definition node to resolve to at all.
//
// Audit 2026-06-12: the unresolved-categorization scoreboard used to count these
// as `fixable:*`, materially overstating the actionable backlog (top "fixable"
// samples were literally `parse`, `log`, `__dirname`). The classifier now routes
// them to a `denylisted-by-design` bucket using THIS list, so the scoreboard
// can't drift from what the resolver actually does. resolver.js imports
// COMMON_NAMES from here so the two can never disagree.

export const COMMON_NAMES = new Set([
  'close', 'open', 'read', 'write', 'get', 'set', 'put', 'delete', 'update',
  'create', 'init', 'start', 'stop', 'run', 'main', 'test', 'log', 'print',
  'send', 'receive', 'connect', 'disconnect', 'load', 'save', 'parse', 'format',
  'json', 'str', 'int', 'len', 'map', 'filter', 'sort', 'find', 'index',
  'push', 'pop', 'append', 'remove', 'clear', 'reset', 'error', 'warn',
  'info', 'debug', 'toString', 'valueOf', 'hasOwnProperty', 'constructor',
  'raise_for_status', 'status_code', 'text', 'content', 'data', 'result',
  'request', 'response', 'handler', 'callback', 'resolve', 'reject',
  '__init__', '__str__', '__repr__', 'self', 'this', 'cls', 'super',
]);

// JS/Node ambient runtime globals — structurally unresolvable (no def node).
export const JS_RUNTIME_GLOBALS = new Set([
  '__dirname', '__filename', 'require', 'module', 'exports', 'process',
  'console', 'globalThis', 'global', 'Buffer', 'setTimeout', 'setInterval',
  'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate',
  'queueMicrotask', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
]);

// True when `name` is a bare short name the resolver refuses by design (so an
// unresolved CALLS/REFERENCES to it is NOT a fixable resolution gap).
export function isDenylistedResolutionTarget(name) {
  return COMMON_NAMES.has(name) || JS_RUNTIME_GLOBALS.has(name);
}
