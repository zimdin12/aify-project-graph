// Normalize a user-supplied PATH argument to the forward-slash form the graph
// stores. Audit (echoes/borrow sweep, codegraph 0171785): on Windows an agent
// naturally passes `src\foo.cpp`, but every File node's file_path is stored with
// forward slashes — so a backslash path arg silently matched nothing and verbs
// returned an empty/"not found" result (a trust regression on our own OS).
//
// Scope this to PATH args only (file=, path=, a path-shaped query) — never to a
// symbol name, which legitimately never contains a backslash anyway.
export function normalizePathArg(value) {
  if (typeof value !== 'string' || !value) return value;
  return value.replace(/\\/g, '/');
}
