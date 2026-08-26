import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { upsertNode } from '../../../mcp/stdio/storage/nodes.js';
import { upsertEdge } from '../../../mcp/stdio/storage/edges.js';
import { hubs, risks } from '../../../mcp/stdio/brief/graph-shape.js';

// ⛔ FAN-IN RANKING COUNTED ONLY CALLS AND REFERENCES, SO A FRAMEWORK-ROUTED APP HAS NO HUBS.
//
// `hubs()` and `risks()` answer "what is most depended upon" by counting inbound edges. Both
// filtered `relation IN ('CALLS','REFERENCES')`, and so does `graph_report`'s hub query.
//
// But this repo's framework ingesters — laravel.js, nestjs.js, node_web.js, python_web.js — emit
// `INVOKES` and `PASSES_THROUGH` for route → middleware → handler chains. On a Laravel, NestJS,
// Express or Flask application those ARE the inbound edges of the handler. So the symbols that the
// application is actually organised around score a fan-in of zero and never rank.
//
// ⛔⛔ AND THE SAME FILE ALREADY KNEW BETTER. `graph-shape.js` line 135 walks
// `['PASSES_THROUGH','INVOKES','CALLS']` for its path exploration — two notions of "call-ish edge"
// in one file, 100 lines apart.
//
// ⚠ WHY NO CORPUS CAUGHT THIS. Measured across the four pinned third-party repositories AND this
// project's own graph: ZERO INVOKES and ZERO PASSES_THROUGH edges exist in any of them — none is a
// web application using a supported framework. The relations are not dead vocabulary; the corpus
// simply cannot express them. Same shape as F10, which was invisible on our own repo because we
// collect JavaScript there and pyright never runs.
//
// ⚠ SCOPE OF THIS TEST'S CLAIM. A synthetic graph proves the RELATION FILTER is wrong and that the
// fix admits routed edges. It does NOT establish how large the effect is on a real Laravel or
// Express repository — no such repository has been measured, and this comment is not evidence that
// one would rank differently by any particular margin.

describe('fan-in ranking counts framework-routed edges, not only direct calls', () => {
  let dir;
  let db;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-hubs-'));
    db = openDb(join(dir, 'graph.sqlite'));
    const node = (id, label, file_path, type = 'Function') => ({
      id, type, label, file_path, start_line: 1, end_line: 1,
      language: 'javascript', confidence: 1, structural_fp: '', dependency_fp: '', extra: {},
    });

    // A routed handler: reached only through the framework, never by a direct call.
    upsertNode(db, node('fn:handler', 'createOrderHandler', 'src/routes/orders.js'));
    // A plainly-called helper: reached by direct CALLS. This is the POSITIVE CONTROL — it must rank
    // both before and after, or the test proves nothing about the change.
    upsertNode(db, node('fn:helper', 'formatMoney', 'src/util/money.js'));

    for (let i = 0; i < 6; i += 1) {
      upsertNode(db, node(`fn:route${i}`, `route_${i}`, 'src/routes/index.js'));
      upsertEdge(db, {
        from_id: `fn:route${i}`, to_id: 'fn:handler', relation: i % 2 ? 'PASSES_THROUGH' : 'INVOKES',
        source_file: 'src/routes/index.js', source_line: 10 + i, confidence: 0.9,
        provenance: 'EXTRACTED', extractor: 'node_web',
      });
    }
    for (let i = 0; i < 3; i += 1) {
      upsertNode(db, node(`fn:caller${i}`, `caller_${i}`, 'src/app.js'));
      upsertEdge(db, {
        from_id: `fn:caller${i}`, to_id: 'fn:helper', relation: 'CALLS',
        source_file: 'src/app.js', source_line: 20 + i, confidence: 0.9,
        provenance: 'EXTRACTED', extractor: 'javascript',
      });
    }
  });

  afterEach(() => {
    try { db.close(); } catch { /* already closed */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('⭐ POSITIVE CONTROL: a directly-called symbol ranks as a hub', () => {
    // Without this, every assertion below is satisfied by a function that ranks everything, or by a
    // fixture that simply has no data.
    const labels = hubs(db, 10).map((h) => h.label);
    expect(labels).toContain('formatMoney');
  });

  it('⛔ a handler reached only by INVOKES/PASSES_THROUGH ranks as a hub', () => {
    const found = hubs(db, 10).find((h) => h.label === 'createOrderHandler');
    expect(found, 'a framework-routed handler must not be invisible to fan-in ranking').toBeTruthy();
    // Six routed edges against the control's three: it must also outrank it, not merely appear.
    expect(found.fan_in).toBe(6);
  });

  it('⛔ it OUTRANKS the directly-called symbol, since it has more inbound edges', () => {
    // Ranking, not just membership. A fix that appended routed edges after all direct ones would
    // pass the membership test and still bury the handler.
    //
    // ⛔ THIS TEST FIRST PASSED FOR THE WRONG REASON. Written as a bare `indexOf(a) < indexOf(b)`,
    // it was GREEN against the unfixed code — because the handler was absent, `indexOf` returned
    // -1, and -1 is less than 0. A ranking assertion over a missing element is not a ranking
    // assertion. Both positions are pinned as present before they are compared.
    const labels = hubs(db, 10).map((h) => h.label);
    const handler = labels.indexOf('createOrderHandler');
    const helper = labels.indexOf('formatMoney');
    expect(handler, 'handler must be present before its rank means anything').toBeGreaterThanOrEqual(0);
    expect(helper, 'control must be present before its rank means anything').toBeGreaterThanOrEqual(0);
    expect(handler).toBeLessThan(helper);
  });

  it('⛔ risks() counts routed edges too — the same filter, the same defect', () => {
    const files = risks(db, 10).map((r) => r.file);
    expect(files).toContain('src/routes/orders.js');
    expect(files).toContain('src/util/money.js'); // positive control, again in the same pass
  });

  it('⭐ THE FILTER DISCRIMINATES: an unrelated relation still does not count as fan-in', () => {
    // The fix must widen to the call family, not to every relation. A DEFINES edge is structural
    // containment and must not inflate a hub score — otherwise every symbol has fan-in ≥ 1.
    upsertNode(db, {
      id: 'file:orders', type: 'File', label: 'orders.js', file_path: 'src/routes/orders.js',
      start_line: 1, end_line: 1, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    upsertNode(db, {
      id: 'fn:lonely', type: 'Function', label: 'neverUsed', file_path: 'src/routes/orders.js',
      start_line: 5, end_line: 6, language: 'javascript', confidence: 1,
      structural_fp: '', dependency_fp: '', extra: {},
    });
    upsertEdge(db, {
      from_id: 'file:orders', to_id: 'fn:lonely', relation: 'DEFINES',
      source_file: 'src/routes/orders.js', source_line: 5, confidence: 1,
      provenance: 'EXTRACTED', extractor: 'javascript',
    });
    expect(hubs(db, 10).map((h) => h.label)).not.toContain('neverUsed');
  });
});
