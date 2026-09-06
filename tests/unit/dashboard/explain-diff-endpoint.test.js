// D4 — the dashboard can now PRODUCE the overlay it was taught to read.
//
// ⛔ THE GAP THIS CLOSES, AND IT IS ONE I MADE. D3 taught the dashboard to read
// `.aify-graph/diff-overlay.json`, closing a claim that had shipped with no consumer. But only
// `graph_explain_diff` writes that file, and that verb is DELISTED from the default tool surface —
// so a human on the dashboard could see an overlay and had no way to cause one to exist. Consumer
// present, producer unreachable: the same unwired shape, mirrored.
//
// Verified before building, with a positive control: the dashboard already imports `buildTour` from
// `query/verbs`, so importing a verb is possible and the absence of explain_diff was a real gap
// rather than an architectural limit.
//
// ⚠ AND THE VERB ANSWERS A DIFFERENT QUESTION FROM THE DELTA, which is why both exist.
// `/api/delta` compares two INDEXED COMMITS and says how the shape moved. `graph_explain_diff` takes
// a GIT RANGE and says what that diff TOUCHES — it maps changed files onto CURRENT symbols and never
// sees the previous graph. Collapsing them would be this repository's recurring wrong-noun error.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { startDashboard } from '../../../mcp/stdio/dashboard/server.js';

let dir;
let db;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-xdiff-'));
  fs.mkdirSync(path.join(dir, '.aify-graph'), { recursive: true });
  db = openDb(path.join(dir, '.aify-graph', 'graph.sqlite'));
});

afterEach(() => {
  try { db.close(); } catch { /* already closed */ }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function get(pathname) {
  const { server, port } = await startDashboard({ db, port: 0, repoRoot: dir });
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON is itself a result */ }
    return { status: res.status, body, text };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

describe('the dashboard can produce the overlay it reads', () => {
  it('★★★ the endpoint answers with JSON, even with no graph behind it', async () => {
    // ⛔ THE FIRST VERSION OF THIS TEST WAS VACUOUS AND PASSED BEFORE THE ENDPOINT EXISTED. It
    // asserted only `status === 200`, and an unknown path on this server falls through to serving
    // index.html with a 200. A test that passes without the feature certifies nothing.
    //
    // So it asserts what only the real route can produce: a JSON body. A non-git temp dir with an
    // empty database is the hostile case, and the route must answer rather than hang or throw —
    // an endpoint that dies on the common empty state is not reachable in practice, which is the
    // failure this whole step exists to fix.
    const { status, body, text } = await get('/api/explain-diff');
    expect(status).toBe(200);
    expect(body, `expected JSON, got: ${text.slice(0, 60)}`).not.toBeNull();
    expect(typeof body).toBe('object');
  });

  it('★★★ it is WIRED, not merely written — the server imports the real verb', () => {
    // ⛔ THE ASSERTION THAT WOULD HAVE CAUGHT THE ORIGINAL DEFECT. A route that exists but calls
    // nothing, or a verb imported but never called, is exactly how diff-overlay.json ended up with a
    // producer nobody could reach.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'mcp/stdio/dashboard/server.js'), 'utf8',
    );
    expect(src, 'the verb must be imported').toContain('graphExplainDiff');
    expect(src, 'and actually called').toMatch(/await graphExplainDiff\(/);
    expect(src, 'the route must exist').toContain('/api/explain-diff');
    // Live control: a name the file does not carry, proving these searches can fail.
    expect(src).not.toContain('graphExplainDiffZzq');
  });

  it('★★★ it asks for the OVERLAY to be written — that is the point of the route', async () => {
    // The verb only writes .aify-graph/diff-overlay.json when overlay:true. Calling it without that
    // flag would give the dashboard a reader it still cannot feed.
    const src = fs.readFileSync(
      path.join(process.cwd(), 'mcp/stdio/dashboard/server.js'), 'utf8',
    );
    // Scoped to the call site rather than the whole file, so an `overlay: true` somewhere else
    // could never satisfy it. The window is generous because the call carries comments.
    const at = src.indexOf('await graphExplainDiff(');
    const call = src.slice(at, src.indexOf('});', at));
    expect(call, 'overlay must be requested or the producer stays unreachable').toContain('overlay: true');
  });
});
