// `apg features <op>`: see which features' anchored code changed since they were last confirmed, and
// stamp a confirmation after re-reading a feature against the code.
//
//   apg features status  [--repo <path>] [--json]
//   apg features confirm <id>... | --all  --by <who> [--repo <path>]
//
// Confirm rewrites .aify-graph/functionality.json in place, touching only each named feature's
// `confirmed` field. It refuses (writes nothing, exit 2) on an unknown id, a missing --by, or an
// unreadable file: a partial stamp would say "confirmed" about features nobody looked at.

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadFunctionality, overlayPath } from './loader.js';
import { confirmFeature, confirmationStatus } from './confirmation.js';

function parseArgs(argv) {
  const out = { ids: [], all: false, by: null, repo: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--by') out.by = argv[++i] ?? null;
    else if (a === '--repo') out.repo = resolve(argv[++i] ?? '.');
    else if (a.startsWith('--')) throw new UsageError(`unknown option ${a}`);
    else out.ids.push(a);
  }
  return out;
}

class UsageError extends Error {}

function describeStatus(feature, status) {
  const head = `${feature.id}: ${status.state}`
    + (status.at ? ` (confirmed ${status.at} by ${status.by})` : '');
  const lines = [head];
  for (const c of status.changes) lines.push(`  ${c.change}: ${c.anchor}`);
  for (const u of status.unwatched) lines.push(`  not watched: ${u.anchor} (${u.reason})`);
  return lines.join('\n');
}

function status(opts, { log }) {
  const overlay = loadFunctionality(opts.repo);
  if (overlay.error) throw new UsageError(`cannot read ${overlay.path}: ${overlay.error}`);
  const rows = overlay.features.map((f) => ({ feature: f, status: confirmationStatus(opts.repo, f) }));
  if (opts.json) {
    log(JSON.stringify(rows.map(({ feature, status: s }) => ({ id: feature.id, ...s })), null, 2));
  } else {
    const count = (state) => rows.filter((r) => r.status.state === state).length;
    log(`${rows.length} features: ${count('changed')} changed since confirmed, ${count('unchanged')} unchanged, ${count('unconfirmed')} never confirmed`);
    for (const r of rows) log(describeStatus(r.feature, r.status));
  }
  return 0;
}

function confirm(opts, { log, now }) {
  if (!opts.by) throw new UsageError('confirm needs --by <who>, so the stamp says who vouched for it');
  if (!opts.all && opts.ids.length === 0) throw new UsageError('confirm needs feature ids or --all');
  const path = overlayPath(opts.repo);
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read ${path}: ${err.message}`);
  }
  const overlay = loadFunctionality(opts.repo);
  const byId = new Map(overlay.features.map((f) => [f.id, f]));
  const targets = opts.all ? [...byId.keys()] : opts.ids;
  const unknown = targets.filter((id) => !byId.has(id));
  if (unknown.length) throw new UsageError(`unknown feature id(s): ${unknown.join(', ')}; nothing written`);

  const at = now().toISOString();
  const stamps = new Map(targets.map((id) => [id, confirmFeature(opts.repo, byId.get(id), { by: opts.by, at })]));
  for (const rawFeature of raw.features) {
    const id = String(rawFeature?.id ?? '').trim();
    if (stamps.has(id)) rawFeature.confirmed = stamps.get(id);
  }
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  renameSync(tmp, path);
  for (const id of targets) {
    const s = stamps.get(id);
    log(`confirmed ${id}: ${Object.keys(s.symbols).length} symbols, ${Object.keys(s.files).length} files`);
  }
  return 0;
}

export function runFeaturesCmd(argv, { log = console.log, error = console.error, now = () => new Date() } = {}) {
  const [op, ...rest] = argv;
  try {
    const opts = parseArgs(rest);
    if (op === 'status') return status(opts, { log });
    if (op === 'confirm') return confirm(opts, { log, now });
    throw new UsageError(`unknown op '${op ?? ''}' (expected status | confirm)`);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    error(`apg features: ${err.message}`);
    return 2;
  }
}
