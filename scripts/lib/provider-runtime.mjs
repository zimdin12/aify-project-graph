// What both dashboard-provider entry points need from the machine they run on: configuration, the real
// instruments, and the commit being described. One owner, so the sweep and the reconfirm cannot drift apart —
// if they resolved an anchor differently, a baseline set by one would never match a comparison by the other,
// and every sweep after a reconfirm would read as `changed` or `restamp` for a reason nobody could see.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractFile } from '../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../mcp/stdio/ingest/languages/index.js';
import { fileStructuralFingerprint } from '../../mcp/stdio/ingest/fingerprint.js';
import { scanDocReferences } from '../../mcp/stdio/analysis/doc-links.js';
import { isDocument } from '../../mcp/stdio/ingest/sweep.js';

/**
 * The real instruments, wired to the resolver's injection points, for one repository.
 *
 * ⚠ EVERY ONE OF THESE IS THE PRODUCTION PATH, not a re-implementation. `isDocument` is imported from
 * `sweep.js` — where the indexer's own copy lives — rather than re-listing document extensions here, because
 * a second list is a defect with a delay on it. (`presentWithExactCase` is the one deliberate exception, and
 * the resolver says why.)
 *
 * The repository is a parameter rather than `process.cwd()` read here, so a caller decides what it points at
 * and a test can point it at a scratch tree.
 */
export function makeInstruments(repoRoot, { at } = {}) {
  const shared = {
    languageOf: (relPath) => getLanguageConfig(relPath),
    isDocument: (relPath) => isDocument(relPath),
    extract: ({ relPath, source, config }) => extractFile({ filePath: relPath, source, config }),
    fileFingerprint: (extracted) => fileStructuralFingerprint(extracted),
    docReferences: (source) => scanDocReferences(source),
  };
  if (at === undefined) {
    // The working tree. Presence is left to the resolver's own segment-by-segment listing.
    return { ...shared, readSource: (relPath) => readFileSync(join(repoRoot, relPath), 'utf8') };
  }
  // ⛔ A COMMIT. Contents come from `git show <at>:<path>` and presence from the object's TYPE at that path, so
  // uncommitted edits neither change an answer nor make it fail (DESIGN-GRAPHS amendment 2). Git looks a path up
  // byte for byte, so a wrong-case spelling is absent here even on a case-insensitive filesystem; and only a
  // `blob` is a file, so a directory is absent too.
  const spec = (relPath) => `${at}:${String(relPath).replaceAll('\\', '/')}`;
  const git = (args) => execFileSync('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024,
  });
  return {
    ...shared,
    readSource: (relPath) => git(['cat-file', 'blob', spec(relPath)]),
    isPresent: (relPath) => {
      try { return git(['cat-file', '-t', spec(relPath)]).trim() === 'blob'; } catch { return false; }
    },
    where: `commit ${String(at).slice(0, 12)}`,
  };
}

/**
 * Where to point, and as whom. Every value comes from the environment; nothing here is a deployment constant.
 *
 * ⛔ THE KEY IS READ AND NEVER PRINTED. From `APG_DASHBOARD_KEY`, or matched out of the file named by
 * `APG_DASHBOARD_ENV` — the value does not reach stdout, a log line or an error message.
 */
export function readProviderConfig(env = process.env, machine = machineFacts()) {
  let keyFromFile;
  if (env.APG_DASHBOARD_ENV) {
    const match = readFileSync(env.APG_DASHBOARD_ENV, 'utf8').match(/^\s*API_KEY\s*=\s*(.+?)\s*$/mu);
    keyFromFile = match?.[1];
  }
  return {
    baseUrl: env.APG_DASHBOARD_URL ?? 'http://localhost:9700',
    apiKey: env.APG_DASHBOARD_KEY ?? keyFromFile,
    hostKey: env.APG_DASHBOARD_HOST ?? 'host-a',
    projectId: env.APG_DASHBOARD_PROJECT,
    // ⛔ DERIVED, NOT A CONSTANT. The service keeps one sweep cursor per (project, reporter), so two installs
    // sharing a name would share a cursor. The override stays: it is what the two-reporter experiment in
    // `docs/evidence/dashboard-seam-2026-09-30/` and the live proofs use.
    reporterId: env.APG_DASHBOARD_REPORTER ?? deriveReporterId(machine),
  };
}

/** The service's limit on a reporter id (aify-dashboard DESIGN-QUIET-ANCHORS, Step 3, at 92bb8c7). */
export const REPORTER_ID_MAX = 128;

/**
 * A reporter name that tells installs apart: `apg@<hostname>/<platform>/<8 hex of the install path>`.
 *
 * PURE. The path is hashed so no path reaches a card. On Windows it is normalised first (slashes, case, a
 * trailing separator), because one directory arrives spelled several ways and a restarted provider must
 * continue the same cursor. Elsewhere case is significant, so it is left alone.
 *
 * ⛔ A name the service would refuse throws here instead of being truncated: a truncated name could collide
 * with another install's, which is the defect this function exists to prevent.
 */
export function deriveReporterId({ hostname: host, platform, isWsl, installPath }) {
  const kind = isWsl ? 'wsl' : platform;
  const path = platform === 'win32'
    ? String(installPath).replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
    : String(installPath).replace(/\/+$/u, '');
  const id = `apg@${host}/${kind}/${createHash('sha256').update(path).digest('hex').slice(0, 8)}`;
  const printable = /^[\x21-\x7e]+$/u.test(String(host ?? ''));
  if (!printable || id.length > REPORTER_ID_MAX) {
    throw new Error(`cannot derive a reporter id the dashboard accepts from hostname ${JSON.stringify(host)} `
      + `(at most ${REPORTER_ID_MAX} printable characters); set APG_DASHBOARD_REPORTER instead`);
  }
  return id;
}

/** The facts `deriveReporterId` needs, read from this machine. WSL reports `linux`, so it is told apart here. */
export function machineFacts() {
  let isWsl = false;
  if (process.platform === 'linux') {
    try { isWsl = /microsoft/iu.test(readFileSync('/proc/version', 'utf8')); } catch { isWsl = false; }
  }
  return {
    hostname: hostname(),
    platform: process.platform,
    isWsl,
    // The APG clone this module runs from: two levels up from scripts/lib/.
    installPath: resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  };
}

/**
 * Whether a run must stop because the tree is not the commit it would name. Returns the refusal, or null.
 *
 * ⛔ A MISSING COUNT IS A REFUSAL, NOT A CLEAN TREE. A guard that passes when its input is missing is decoration.
 */
export function dirtyRefusal({ dirty, allowDirty, act }) {
  if (allowDirty) return null;
  if (!Number.isInteger(dirty) || dirty < 0) {
    return `could not count uncommitted paths, so this ${act} cannot say which code it read; refusing`;
  }
  if (dirty === 0) return null;
  return `${dirty} uncommitted path(s): this ${act} would read the TREE but name the COMMIT, and the `
    + 'dashboard cannot see the difference. Commit or stash, or pass --allow-dirty to proceed knowingly';
}

/** The commit a run describes. ⛔ The COMMIT, because the tree can move under a long run. */
export function headOf(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

/** How many paths differ from that commit. Reported, never corrected — the caller decides what it means. */
export function dirtyCountOf(repoRoot) {
  const out = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], { encoding: 'utf8' });
  return out.split('\n').filter((l) => l.trim() !== '').length;
}
