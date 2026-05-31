// Shared child_process options helper.
//
// WHY: the MCP server runs under GUI hosts (Claude Code / Hermes) on win32.
// Every execFileSync/spawn/spawnSync that launches a real external process
// (git, npm, clangd, ...) without `windowsHide: true` briefly flashes a
// console window on Windows. Setting `windowsHide` suppresses that flash and
// is a no-op on POSIX. Use `withHidden(opts)` at call sites so the intent is
// documented and consistent across the codebase.

// Documented constant: pass-through value for child_process `windowsHide`.
export const WINDOWS_HIDE = true;

/**
 * Return a shallow copy of `opts` with `windowsHide: true` added.
 * Does NOT mutate the input object.
 *
 * @param {object} [opts] base child_process options
 * @returns {object} new options object with windowsHide enabled
 */
export function withHidden(opts = {}) {
  return { ...opts, windowsHide: WINDOWS_HIDE };
}
