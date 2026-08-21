// THE AMBIENT POPULATION, ENUMERATED RATHER THAN PRETENDED AWAY.
//
// ⛔ A materialized candidate tree fixes SOURCE attribution and nothing else. `node_modules` is
// ignored by git, so it cannot come from the tree object `T` — the run still depends on ambient
// state by construction. I asked whether that made materialization pointless; graph-senior-dev's
// answer is the right frame:
//
//   > The honest endpoint is not "no ambient dependencies"; it is: source/test filesystem
//   > materialized exactly from T, plus a small explicitly enumerated dependency/environment
//   > carrier whose immutability limits are stated.
//
// ⇒ So this module does not make dependencies immutable. It makes them NAMED. A receipt that says
// "shared mutable dependency transport, here is exactly which one" is honest; a receipt that omits
// them entirely implies a hermeticity it does not have.
//
// ⚠ AND THE LIMIT IS STATED IN THE DATA, not only in prose: `closureInventoried: false` travels in
// every receipt, because hashing two lockfiles is not the same as inventorying the whole
// `node_modules` closure and must never be reported as if it were.
import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = (b) => createHash('sha256').update(b).digest('hex');

/** Hash a file, or record why it could not be hashed. Never silently absent. */
function fileFact(path) {
  if (!existsSync(path)) return { path, present: false };
  try {
    return { path, present: true, bytes: statSync(path).size, sha256: sha(readFileSync(path)) };
  } catch (err) {
    // ⛔ An unreadable dependency is UNKNOWN, never "fine". A receipt that skipped it would be
    // claiming a carrier it could not read.
    return { path, present: true, unreadable: String(err.message) };
  }
}

/**
 * Everything outside the source tree that a gate run depends on, named.
 *
 * @param {string} root         the materialized worktree (or checkout) the gates run in
 * @param {string} depsRealpath the actual target the dependency link resolves to
 */
export function dependencyCarrier(root, depsRealpath) {
  const nodeExe = process.execPath;
  const vitestEntry = join(root, 'node_modules', 'vitest', 'vitest.mjs');

  // ⚠ NATIVE ADDONS ARE MEASURED WHERE MEASURABLE. better-sqlite3 in particular is compiled code
  // the tests execute; a lockfile hash says which VERSION was requested, never which BINARY loaded.
  const nativeCandidates = [
    join(root, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    join(root, 'node_modules', 'better-sqlite3', 'prebuilds'),
  ];

  return {
    // ⛔ THE HEADLINE LIMIT, IN THE DATA. Two lockfile hashes are not a closure inventory.
    closureInventoried: false,
    transport: 'shared mutable dependency link — NOT immutable, NOT reproducible from lockfiles alone',
    linkTargetRealpath: (() => {
      try { return realpathSync(depsRealpath); } catch { return null; }
    })(),
    node: {
      version: process.version,
      execPathRealpath: (() => { try { return realpathSync(nodeExe); } catch { return nodeExe; } })(),
      ...fileFact(nodeExe),
    },
    lockfiles: [
      fileFact(join(root, 'package-lock.json')),
      fileFact(join(root, 'node_modules', '.package-lock.json')),
    ],
    runner: fileFact(vitestEntry),
    native: nativeCandidates.map((p) => (existsSync(p) && statSync(p).isDirectory()
      ? { path: p, present: true, directory: true }
      : fileFact(p))),
    platform: `${process.platform}/${process.arch}`,
    env: environmentAllowlist(),
  };
}

/**
 * Environment variables that can change what the tests do.
 *
 * ⛔ AN ALLOWLIST, NOT A DUMP. Capturing the whole environment would leak secrets into a committed
 * receipt; capturing none would hide the switches that change behaviour. This repo has already been
 * bitten by `APG_AUTO_REINDEX` silently moving a graph mid-run.
 */
export const ENV_ALLOWLIST = [
  'APG_AUTO_REINDEX', 'APG_TELEMETRY_DIR', 'APG_TEST_FORCE_SOURCE_SCAN_FAIL',
  'APG_CLANGD_INDEX_WAIT_MS', 'CI', 'NODE_ENV', 'NODE_OPTIONS', 'TZ', 'VITEST_MAX_THREADS',
];

export function environmentAllowlist(env = process.env) {
  const out = {};
  for (const k of ENV_ALLOWLIST) if (env[k] !== undefined) out[k] = env[k];
  return out;
}

/**
 * Ignored paths present in a materialized worktree, minus the one transport we declared.
 *
 * ⛔ IGNORED FILES ARE IN NEITHER `T` NOR `ls-files --others`, YET GATES CAN READ THEM. That is the
 * unnamed population the referee identified: `.aify-graph`, caches, generated configs. A candidate
 * run must refuse anything ignored that it did not itself put there.
 *
 * ⚠ `.aify-graph` MATERIALISES ON ITS OWN in fresh worktrees — observed, producer unidentified. It
 * is therefore exactly the kind of state this check exists to catch, not an exception to it.
 */
export function unexpectedIgnored(ignoredPaths, allowed = ['node_modules']) {
  const allowedSet = new Set(allowed);
  return (ignoredPaths ?? []).filter((p) => {
    const segments = p.split(/[\\/]/).filter(Boolean);
    // ⛔ MATCH ANY SEGMENT, NOT JUST THE HEAD. My first version compared only the leading
    // segment, so a declared output nested inside a fixture -- tests/fixtures/.../.aify-graph/ --
    // read as undeclared. Measured: the suite creates graph databases INSIDE fixture repos as part
    // of testing, and those are the same declared product as the top-level one.
    //
    // ⚠ THE BOUND THIS ACCEPTS, STATED: a declared output name is allowed at ANY depth. That is
    // broader than a single path, and it is the honest description of what the gate produces.
    return !segments.some((seg) => allowedSet.has(seg));
  });
}
