// Feature confirmation: "has the code this feature is anchored to changed since someone last confirmed
// the feature's description?"
//
// A confirmation stamps a hash of every anchored symbol's text and every anchored file. A status check
// re-reads the same anchors from the working tree and names each one that changed or is gone. The answer
// is a FACT about the code ("`alpha` in src/a.js changed since 2026-09-18"), never a verdict that the
// description is wrong; deciding that is the reader's job, and re-confirming clears the ping.
//
// Measured before it was built (docs/evidence/feature-map-pings-2026-09-18/RESULTS-4.md): on a repo moving
// ~280 commits a week, symbol-level pings caught 8 of 9 features that really went stale, and fired on 34%
// of features a week. File-level pings caught 9 of 9 at 57%. So symbols decide the state; files are
// reported beside them.
//
// Symbols are re-extracted from the file on disk with the indexer's own extractor, not read from the graph:
// the graph's line ranges date from the last index, and after an uncommitted edit they point at the wrong
// lines, which would ping unchanged code.
//
// ⚠ WHAT THIS CANNOT SEE, stated where it is decided:
//   - glob file anchors (`src/auth/*`) are not watched; they are listed as `unwatched`;
//   - a symbol is looked up only in the feature's literal anchored files, so a symbol anchored without
//     its file, or one in a file with no language config, is `unwatched`;
//   - a change to code the anchors do not name (a caller, a config value) does not ping. A feature is only
//     as well watched as its anchors are chosen.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, sep } from 'node:path';
import { extractFile } from '../ingest/extractors/generic.js';
import { getLanguageConfig, hasLanguageConfig } from '../ingest/languages/index.js';

const CONTAINER_TYPES = new Set(['File', 'Module', 'Directory']);
const GLOB_CHARS = /[*?[\]]/u;

export const CONFIRMATION_STATES = Object.freeze({
  UNCONFIRMED: 'unconfirmed',
  UNCHANGED: 'unchanged',
  CHANGED: 'changed',
});

// ── pure ─────────────────────────────────────────────────────────────────────────────────────────────

export function textHash(text) {
  return createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
}

export function symbolKey(file, name) {
  return `${file}#${name}`;
}

// The text of every node named `name` in an extracted file, joined in source order. Overloads and a
// class plus its same-named method all count: any of them changing is a change to the anchor.
export function symbolText(source, nodes, name) {
  const lines = source.split('\n');
  const spans = nodes
    .filter((n) => n.label === name && !CONTAINER_TYPES.has(n.type))
    .map((n) => [n.start_line, n.end_line])
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;
  return spans.map(([s, e]) => lines.slice(s - 1, e).join('\n')).join('\n---\n');
}

// Compare a stamp to the current hashes. Returns one entry per anchor that differs.
export function compareStamp(stamp, current) {
  const changes = [];
  for (const kind of ['symbols', 'files']) {
    const was = stamp?.[kind] ?? {};
    const now = current[kind];
    for (const [anchor, hash] of Object.entries(was)) {
      if (!(anchor in now) || now[anchor] === null) changes.push({ kind, anchor, change: 'gone' });
      else if (now[anchor] !== hash) changes.push({ kind, anchor, change: 'changed' });
    }
    for (const anchor of Object.keys(now)) {
      if (!(anchor in was)) changes.push({ kind, anchor, change: 'not-in-confirmation' });
    }
  }
  return changes;
}

// ── reading the working tree ─────────────────────────────────────────────────────────────────────────

function readRepoFile(repoRoot, file) {
  const rel = normalize(file);
  // A path that leaves the repo is not an anchor this module will read.
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return { error: 'outside the repository' };
  try {
    // CRLF normalised at the read, once: a symbol slice cut from CRLF text keeps a trailing `\r` that a
    // later normalisation cannot see, and a checkout's line endings are not a change.
    return { source: readFileSync(join(repoRoot, rel), 'utf8').replace(/\r\n/gu, '\n') };
  } catch (err) {
    return err?.code === 'ENOENT' ? { source: null } : { error: String(err?.code ?? err?.message ?? err) };
  }
}

// Current hashes for a feature's anchors, plus what could not be watched and why.
export function readAnchors(repoRoot, feature) {
  const files = {};
  const symbols = {};
  const unwatched = [];
  const extracted = new Map();

  for (const file of feature.anchors?.files ?? []) {
    if (GLOB_CHARS.test(file)) {
      unwatched.push({ anchor: file, reason: 'glob file anchors are not watched' });
      continue;
    }
    const read = readRepoFile(repoRoot, file);
    if (read.error) {
      unwatched.push({ anchor: file, reason: read.error });
      continue;
    }
    files[file] = read.source === null ? null : textHash(read.source);
    if (read.source !== null && hasLanguageConfig(file)) {
      try {
        const { nodes } = extractFile({ filePath: file, source: read.source, config: getLanguageConfig(file) });
        extracted.set(file, { source: read.source, nodes });
      } catch (err) {
        unwatched.push({ anchor: file, reason: `could not parse: ${String(err?.message ?? err).slice(0, 80)}` });
      }
    }
  }

  for (const name of feature.anchors?.symbols ?? []) {
    let found = false;
    for (const [file, { source, nodes }] of extracted) {
      const text = symbolText(source, nodes, name);
      if (text !== null) {
        symbols[symbolKey(file, name)] = textHash(text);
        found = true;
      }
    }
    if (!found) unwatched.push({ anchor: name, reason: 'not defined in any literal anchored file' });
  }
  return { files, symbols, unwatched };
}

// ── the two operations ───────────────────────────────────────────────────────────────────────────────

// The stamp to store on a feature as `confirmed`. Gone anchors are not stamped: confirming a feature
// whose anchor no longer exists records only what exists, and the missing anchor stays visible as
// `unwatched` on the next status check.
export function confirmFeature(repoRoot, feature, { by, at }) {
  if (!by) throw new Error('confirmFeature: `by` is required, so a stamp always says who confirmed it');
  if (!at) throw new Error('confirmFeature: `at` is required');
  const current = readAnchors(repoRoot, feature);
  const present = (map) => Object.fromEntries(Object.entries(map).filter(([, h]) => h !== null));
  return { at, by, symbols: present(current.symbols), files: present(current.files) };
}

// Counts across a feature map, plus the changed features by name, for graph_health.
export function summarizeConfirmations(repoRoot, features, { sample = 5 } = {}) {
  const rows = features.map((f) => ({ id: f.id, status: confirmationStatus(repoRoot, f) }));
  const count = (state) => rows.filter((r) => r.status.state === state).length;
  return {
    changed: count(CONFIRMATION_STATES.CHANGED),
    unchanged: count(CONFIRMATION_STATES.UNCHANGED),
    unconfirmed: count(CONFIRMATION_STATES.UNCONFIRMED),
    changedSample: rows
      .filter((r) => r.status.state === CONFIRMATION_STATES.CHANGED)
      .slice(0, sample)
      .map((r) => ({ id: r.id, confirmedAt: r.status.at, changes: r.status.changes.map((c) => `${c.change}: ${c.anchor}`) })),
  };
}

// summarizeConfirmations for a caller that must not fail on it (graph_health): a failure is returned as
// `{ error }`, which the caller reports, never as zero changed.
export function readConfirmations(repoRoot, features) {
  try {
    return summarizeConfirmations(repoRoot, features);
  } catch (err) {
    return { error: String(err?.message ?? err).slice(0, 120) };
  }
}

// The state of one feature. `changed` is decided by SYMBOLS; file changes are reported beside it.
// A feature with no watchable symbols falls back to its files, so it is never silently always-unchanged.
export function confirmationStatus(repoRoot, feature) {
  const current = readAnchors(repoRoot, feature);
  const stamp = feature.confirmed;
  if (!stamp || typeof stamp !== 'object') {
    return { state: CONFIRMATION_STATES.UNCONFIRMED, changes: [], unwatched: current.unwatched };
  }
  const changes = compareStamp(stamp, current);
  const watchesSymbols = Object.keys(stamp.symbols ?? {}).length > 0;
  const deciding = changes.filter((c) => (watchesSymbols ? c.kind === 'symbols' : true));
  return {
    state: deciding.length ? CONFIRMATION_STATES.CHANGED : CONFIRMATION_STATES.UNCHANGED,
    at: stamp.at ?? null,
    by: stamp.by ?? null,
    basis: watchesSymbols ? 'symbols' : 'files',
    changes,
    unwatched: current.unwatched,
  };
}
