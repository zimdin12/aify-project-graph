#!/usr/bin/env node
// M0b arm 2 — SCALE QUALIFICATION OF THE GROUPING MACHINERY, ON THIS APG SNAPSHOT.
//
// Arm 1 asks whether the identity rule can tell the known C++ classes apart. Arm 2 asks a
// different question on a different population: at realistic graph size, does the machinery around
// the rule — retrieval cap, candidate totals, group counts, latency — behave?
//
// ⛔ THIS ARM SAYS NOTHING ABOUT C++ SEMANTICS. The population is this repo: JavaScript. It cannot
// validate overload or linkage handling and does not claim to.
//
// ⚠ CARRIER. This calls the CURRENT CHECKOUT'S functions in process. It is NOT the running MCP
// server, which is on an older commit and (correctly) refuses to answer at all. Two different
// carriers; this one is labelled rather than passed off as the server's behaviour.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => pathToFileURL(path.join(REPO, ...p)).href;
const { resolveSymbol, resolveSymbolWithTotal, buildAmbiguousMatchMessage } =
  await import(url('mcp', 'stdio', 'query', 'verbs', 'symbol_lookup.js'));
const { openDb } = await import(url('mcp', 'stdio', 'storage', 'db.js'));

const DB_PATH = path.join(REPO, '.aify-graph', 'graph.sqlite');
const RETRIEVAL_CAP = 50;   // the LIMIT in every resolveSymbol query, read from the source

// The repo's own wrapper, not a raw better-sqlite3 handle: the verbs call db.all/db.get, and a
// raw handle would fail loudly here but could just as easily have failed QUIETLY somewhere else.
const db = openDb(DB_PATH);

const totalNodes = db.get('SELECT count(*) c FROM nodes').c;
const busiest = db.all(`
  SELECT label, count(*) c, count(DISTINCT file_path) f
  FROM nodes WHERE type IN ('Function','Method','Class')
  GROUP BY label ORDER BY c DESC LIMIT 15`);

// NEGATIVE CONTROL: a spelling that is not in the graph must resolve to zero rows and produce no
// ambiguity message. A probe that cannot return empty cannot return a candidate list.
const absentRows = resolveSymbol(db, 'this_symbol_is_not_in_the_graph_m0b');
const absentMessage = buildAmbiguousMatchMessage('this_symbol_is_not_in_the_graph_m0b', absentRows);

// POSITIVE CONTROL: a spelling with exactly one definition must resolve and must NOT be ambiguous.
const singleton = db.get(`
  SELECT label FROM nodes WHERE type IN ('Function','Method','Class')
  GROUP BY label HAVING count(*) = 1 ORDER BY label LIMIT 1`);
const singletonRows = singleton ? resolveSymbol(db, singleton.label) : [];
const singletonMessage = singleton ? buildAmbiguousMatchMessage(singleton.label, singletonRows) : null;

const measurements = [];
for (const row of busiest) {
  const t0 = process.hrtime.bigint();
  const { rows, total } = resolveSymbolWithTotal(db, row.label);
  const message = buildAmbiguousMatchMessage(row.label, rows, 5, total);
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
  measurements.push({
    label: row.label,
    definitionsInGraph: row.c,
    filesInGraph: row.f,
    rowsRetrieved: rows.length,
    rowsTotalReported: total,
    hitRetrievalCap: rows.length >= RETRIEVAL_CAP,
    ambiguityFired: Boolean(message),
    messageBytes: message ? Buffer.byteLength(message, 'utf8') : 0,
    elapsedMs: Number(elapsedMs.toFixed(2)),
    // Does the emitted text state a group count, and does it name the retrieval limit as a limit?
    statesTotal: message ? /\b\d+\b[^\n]*\btotal\b|\bof\b\s*\d+/i.test(message) : null,
  });
}

const anyAtCap = measurements.some((m) => m.hitRetrievalCap);

const out = {
  takenAt: new Date().toISOString(),
  carrier: 'in-process call of the current checkout (NOT the running MCP server, which is on an older commit and refuses)',
  population: 'this repo — JavaScript. Says nothing about C++ semantics.',
  db: DB_PATH,
  totalNodes,
  retrievalCap: RETRIEVAL_CAP,
  maxDefinitionsForAnyName: busiest[0]?.c ?? 0,
  capExercised: anyAtCap,
  capNotExercisedBecause: anyAtCap ? null
    : `no name in this graph has more than ${busiest[0]?.c ?? 0} definitions, so nothing reaches the ${RETRIEVAL_CAP}-row cap. The cap is UNQUALIFIED by this arm.`,
  controls: {
    negative_absentSpellingResolvesEmpty: absentRows.length === 0 && absentMessage === null,
    positive_singletonIsNotAmbiguous: Boolean(singleton) && singletonRows.length >= 1 && singletonMessage === null,
    positive_singletonLabel: singleton?.label ?? null,
    liveness_graphHasNodes: totalNodes > 0,
  },
  measurements,
};

fs.writeFileSync(path.join(REPO, 'docs', 'evidence', 'identity-qualification', 'ARM2-SCALE.json'),
  `${JSON.stringify(out, null, 2)}\n`, 'utf8');

process.stdout.write(`nodes=${totalNodes} retrievalCap=${RETRIEVAL_CAP} maxDefsForAnyName=${out.maxDefinitionsForAnyName}\n`);
process.stdout.write(`controls: negative=${out.controls.negative_absentSpellingResolvesEmpty ? 'PASS' : 'FAIL'} `
  + `positive=${out.controls.positive_singletonIsNotAmbiguous ? 'PASS' : 'FAIL'} (${out.controls.positive_singletonLabel}) `
  + `liveness=${out.controls.liveness_graphHasNodes ? 'PASS' : 'FAIL'}\n`);
process.stdout.write(`cap exercised by this population: ${anyAtCap ? 'YES' : 'NO'}\n`);
if (!anyAtCap) process.stdout.write(`  -> ${out.capNotExercisedBecause}\n`);
process.stdout.write('\nlabel                 defs files rows total ambiguous bytes   ms\n');
for (const m of measurements) {
  process.stdout.write(`${m.label.padEnd(21)} ${String(m.definitionsInGraph).padStart(4)} `
    + `${String(m.filesInGraph).padStart(5)} ${String(m.rowsRetrieved).padStart(4)} `
    + `${String(m.rowsTotalReported).padStart(5)} ${String(m.ambiguityFired).padStart(9)} `
    + `${String(m.messageBytes).padStart(5)} ${String(m.elapsedMs).padStart(4)}\n`);
}
