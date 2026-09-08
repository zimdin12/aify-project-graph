// D3 — the dashboard grows a TIME DIMENSION, and the unwired claim finally becomes true.
//
// ⛔ TWO THINGS THIS CLOSES.
//
// 1. The dashboard had NO notion of time. Verified with a positive control earlier today: its only
//    "history" is a navigation back-stack, and `loadOverlayJson` was called EIGHT times, always for
//    `functionality.json` or `tasks.json`. A static map answers "what is there", never "what moved".
//
// 2. `graph_explain_diff` wrote `.aify-graph/diff-overlay.json` "for the dashboard blast-radius
//    highlight" and NOTHING READ IT. Producer proven, consumer absent, claim shipped — the fourth
//    recorded instance of that shape here. The tool description was corrected to say so plainly;
//    this endpoint is what lets it be true again rather than merely honest.
//
// ⭐ AND IT CARRIES ITS OWN ABANDON RULE. The preregistration says: fewer than three opens in the
// fourteen days after it ships and the delta view gets no further investment. That has to be
// instrumented by the thing itself, not by memory and not by asking — so every request appends one
// line to an access log.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { startDashboard } from '../../../mcp/stdio/dashboard/server.js';
import { ensurePublicationTables } from '../../../mcp/stdio/storage/publication-schema.js';
import { writeStructuralDigest } from '../../../mcp/stdio/storage/structural-digest-store.js';
import { buildDigest, symbolKey } from '../../../mcp/stdio/storage/structural-digest.mjs';

const SHA = (c) => c.repeat(40);

const digestFor = (commit, extra = []) => buildDigest({
  commit,
  extractorVersion: '0.5.0',
  symbols: [
    { qname: 'render', file: 'ui/render.js', layer: 'ui' },
    { qname: 'load', file: 'data/load.js', layer: 'data' },
    ...extra,
  ],
  edges: [{ from: symbolKey('render', 'ui/render.js'), to: symbolKey('load', 'data/load.js'), relation: 'CALLS' }],
});

let dir;
let db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-delta-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  db = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
  ensurePublicationTables(db);
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function get(pathname) {
  const { server, port } = await startDashboard({ db, port: 0, repoRoot: dir });
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('the dashboard can answer what changed, not only what is there', () => {
  it('★★★ two stored digests produce a delta the page can render', async () => {
    writeStructuralDigest(db, digestFor(SHA('a')), { createdAt: '2026-09-01T00:00:00.000Z' });
    writeStructuralDigest(db, digestFor(SHA('b'), [{ qname: 'log', file: 'util/log.js', layer: 'util' }]),
      { createdAt: '2026-09-02T00:00:00.000Z' });

    const { status, body } = await get('/api/delta');
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.fromCommit).toBe(SHA('a'));
    expect(body.toCommit).toBe(SHA('b'));
    expect(body.delta.symbolsAdded).toEqual([{ qname: 'log', file: 'util/log.js' }]);
  });

  it('★★★ NO HISTORY IS SAID PLAINLY, never rendered as "nothing changed"', async () => {
    // ⛔ An empty delta and an absent one look identical on a page. One means the code held still;
    // the other means nobody measured. Collapsing them is the fail-open direction because it
    // reassures, and this endpoint is the surface where a human would believe it.
    const { body } = await get('/api/delta');
    expect(body.available).toBe(false);
    expect(body.reason).toBeTruthy();
    expect(body.delta).toBeNull();
  });

  it('★★★ THE UNWIRED CLAIM, CLOSED: the diff overlay is finally read', async () => {
    // graph_explain_diff has been writing this file for a dashboard highlight that did not exist.
    fs.writeFileSync(
      path.join(dir, '.aify-graph', 'diff-overlay.json'),
      JSON.stringify({ schema_version: '0.1', range: 'main...HEAD', changedNodeIds: ['n1'], affectedNodeIds: ['n2'] }),
    );
    const { body } = await get('/api/delta');
    expect(body.diffOverlay, 'the dashboard must actually read it now').not.toBeNull();
    expect(body.diffOverlay.changedNodeIds).toEqual(['n1']);
    expect(body.diffOverlay.range).toBe('main...HEAD');
  });

  it('★★ an absent overlay is null rather than a fabricated empty one', async () => {
    // Positive control for the assertion above: it can distinguish present from absent, so the
    // present case is a measured result and not a default that always looks the same.
    const { body } = await get('/api/delta');
    expect(body.diffOverlay).toBeNull();
  });

  it('★★★ THE ABANDON RULE IS INSTRUMENTED BY THE THING ITSELF', async () => {
    // ⛔ Preregistered: fewer than three opens in fourteen days and this gets no further investment.
    // A rule measured by memory is not a rule, and asking Steven whether he opened it would replace
    // the measurement with a recollection.
    await get('/api/delta');
    const log = path.join(dir, '.aify-graph', 'delta-views.log');
    expect(fs.existsSync(log), 'every open must leave a trace').toBe(true);
    const first = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    expect(first.length).toBe(1);
    expect(first[0], 'each line carries when it was opened').toMatch(/^\d{4}-\d{2}-\d{2}T/);

    await get('/api/delta');
    const second = fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean);
    expect(second.length, 'opens accumulate rather than overwrite').toBe(2);
  });
});
