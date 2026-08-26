// scripts/ab-arm-worker.mjs
//
// Index one arm, in its OWN process, and write the graph summary as JSON.
//
// ⛔ THE PROCESS BOUNDARY IS THE WHOLE POINT, and it exists because its absence produced two void
// measurements. The parent harness edits a source file between arms, but Node's ESM module cache
// loads a module ONCE per process — so a parent that imports `ensureFresh` up front runs BOTH arms
// against the module it loaded at startup. The edit lands on disk, the probe finds it there, the file
// parses, and the measurement is of nothing at all.
//
// ⚠ THAT IS THE "mutation landed but changed nothing" FAILURE the parent's own header warns about,
// committed by the parent. A probe that checks the FILE does not establish that the RUNNING code
// changed. Only a fresh process does.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repoRoot, graphDir, outFile, livenessLabel] = process.argv.slice(2);

const { ensureFresh } = await import(pathToFileURL(join(repoRoot, 'mcp/stdio/freshness/orchestrator.js')).href);
const { openExistingDb } = await import(pathToFileURL(join(repoRoot, 'mcp/stdio/storage/db.js')).href);

const SEP = String.fromCharCode(1);
const manifest = await ensureFresh({ repoRoot, graphDir, force: true });

const db = openExistingDb(join(graphDir, 'graph.sqlite'));
let payload;
try {
  const nodes = db.all('SELECT id, type, label FROM nodes').map((r) => [r.id, r.type, r.label].join(SEP));
  const edges = db.all('SELECT from_id, to_id, relation, source_file, source_line FROM edges')
    .map((r) => [r.from_id, r.to_id, r.relation, r.source_file, r.source_line].join(SEP));
  payload = {
    nodes,
    edges,
    byRelation: Object.fromEntries(
      db.all('SELECT relation, COUNT(*) AS n FROM edges GROUP BY relation').map((r) => [r.relation, r.n]),
    ),
    externalByRelation: Object.fromEntries(
      db.all(`SELECT e.relation AS r, COUNT(*) AS n FROM edges e
                JOIN nodes dst ON dst.id = e.to_id
               WHERE dst.type = 'External' GROUP BY e.relation`).map((r) => [r.r, r.n]),
    ),
    // ⚠ The trust pair travels with the graph counts because it is a number this project asserts in
    // commit messages, and it moved by 27,957 once without anyone noticing.
    manifest: {
      commit: manifest?.commit ?? null,
      dirtyEdgeCount: manifest?.dirtyEdgeCount ?? null,
      trustDirtyEdgeCount: manifest?.trustDirtyEdgeCount ?? null,
    },
    liveness: livenessLabel
      ? nodes.some((k) => k.endsWith(`${SEP}${livenessLabel}`))
      : true,
  };
} finally {
  db.close();
}

writeFileSync(outFile, JSON.stringify(payload));
