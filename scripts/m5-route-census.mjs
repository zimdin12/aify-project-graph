// ROUTE CENSUS — which verbs can PUBLICATION STATE actually reach?
//
//   node scripts/m5-route-census.mjs
//
// The linkage-scope key names this as PREREQUISITE EVIDENCE, not analysis:
//
//   "code_intel_hierarchy consumes ZERO publication state, and code_intel_references is the verb the
//    field report shows a tester actually using. A gate-disabled mutant may therefore change nothing
//    on that route. Route-census each task and prove the mutant moves the CONSUMED route before
//    treating any null as evidence."
//
// A null on a route the treatment cannot reach is a fact about the WIRING, not about the product. So
// this runs before any arm does, and it costs no agent budget.
//
// ⛔ DERIVED, NOT LISTED. The population is `TOOLS` from the real registry and the consumer set is
// the `verbName:` each verb hands to inspectReadFreshness. A hand-maintained list of "the graph
// verbs" is a defect with a delay on it: it would still look right the day someone adds the 44th.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOLS } from '../mcp/stdio/tools/schema.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBS = join(REPO, 'mcp/stdio/query/verbs');

// ── The consumer set, read from the verbs themselves ─────────────────────────────────────────
// TWO DOORS, and the first version of this census knew only one.
//
//   SHARED DOOR — inspectReadFreshness reads the publication record, classifies attestation, and
//   returns `blocker`/`warnings` the calling verb renders via prefixReadWarnings. The caller names
//   itself in `verbName:`, which is what binds a file to a registered tool.
//
//   DIRECT DOOR — health.js and status.js import publication-schema themselves and never call
//   inspectReadFreshness at all.
//
// ⛔ Counting only the shared door reported graph_health — THE trust verb — as a non-consumer. The
// census had one positive control, on the door it already implemented, so it certified the
// instrument on the only inputs it handled correctly. That is the same defect, in the same hour, as
// the evidence gate whose positive control used the one population its broken probe still served.
const consuming = new Map(); // toolName -> { file, door }
const unbound = [];
const registrySet = new Set(TOOLS.map((t) => t.name));

for (const file of readdirSync(VERBS).filter((f) => f.endsWith('.js'))) {
  const text = readFileSync(join(VERBS, file), 'utf8');
  // The module that DEFINES the shared door is not a verb that walks through it. Excluded by that
  // property rather than by name, so a rename cannot quietly turn it back into a phantom tool.
  if (/export\s+(async\s+)?function\s+inspectReadFreshness/.test(text)) continue;
  const shared = text.includes('inspectReadFreshness');
  const direct = text.includes('publication-schema');
  if (!shared && !direct) continue;

  const declared = [...text.matchAll(/verbName:\s*'([a-z_]+)'/g)].map((m) => m[1]);
  for (const name of declared) consuming.set(name, { file, door: 'shared' });

  // A direct-door file declares no verbName. Derive its tool from the filename and REQUIRE the
  // registry to confirm it — an unconfirmed guess is reported, never silently dropped, because a
  // dropped verb is invisible in exactly the column that would matter.
  if (direct && declared.length === 0) {
    const guess = `graph_${file.replace(/\.js$/, '')}`;
    if (registrySet.has(guess)) consuming.set(guess, { file, door: 'direct' });
    else unbound.push(`${file} (guessed ${guess}, not in the registry)`);
  }
}

const registry = TOOLS.map((t) => t.name).sort();
const consumes = registry.filter((n) => consuming.has(n));
const cannot = registry.filter((n) => !consuming.has(n));

console.log(`ROUTE CENSUS — publication state, over ${registry.length} registered tools\n`);
console.log(`CONSUMES publication state (${consumes.length}):`);
for (const n of consumes) console.log(`  ${n.padEnd(26)} ${consuming.get(n).file.padEnd(22)} [${consuming.get(n).door} door]`);
console.log(`\nDOES NOT (${cannot.length}):`);
for (const n of cannot) console.log(`  ${n}`);

// ── The finding the experiment turns on ──────────────────────────────────────────────────────
const DELETE_DECISION = ['code_intel_references', 'code_intel_hierarchy'];
const reached = DELETE_DECISION.filter((n) => consuming.has(n));
console.log('\nTHE DELETE-DECISION ROUTE');
console.log(`  verbs the product's own text routes a delete decision to: ${DELETE_DECISION.join(', ')}`);
console.log(`  of those, consuming publication state: ${reached.length ? reached.join(', ') : 'NONE'}`);
console.log(reached.length === 0
  ? '  => a publication-state treatment CANNOT move this route. Any null here is about the wiring.'
  : '  => the route is reachable; a null here would be evidence about the treatment.');

// ── CONTROLS, same pass ──────────────────────────────────────────────────────────────────────
// ⛔ Every line above rests on a set built by a regex. A regex that matched nothing would print a
// perfectly clean, perfectly wrong census — and the wrong answer here is the one I expect, so
// nothing would collide.
const prefixes = new Set(registry.map((n) => n.split('_')[0]));
console.log('\nCONTROLS');
console.log(`  registry non-empty ................... ${registry.length > 0} (${registry.length})`);
console.log(`  POSITIVE (shared door): graph_callers . ${consuming.get('graph_callers')?.door === 'shared'}`);
// ⛔ THE CONTROL THE FIRST VERSION LACKED. graph_health consumes through the DIRECT door and was
// reported a non-consumer. Without a positive control per door, a census can be blind to a whole
// mechanism and still print a clean, confident table.
console.log(`  POSITIVE (direct door): graph_health ... ${consuming.get('graph_health')?.door === 'direct'}`);
console.log(`  both doors are represented ........... ${new Set([...consuming.values()].map((v) => v.door)).size === 2}`);
console.log(`  every consumer bound to the registry . ${unbound.length === 0}${unbound.length ? ` -> ${unbound.join('; ')}` : ''}`);
console.log(`  NEGATIVE: a bare name is not matched . ${!consuming.has('definitely_not_a_verb')}`);
console.log(`  the scan read more than one family ... ${prefixes.size > 1} (${[...prefixes].join(', ')})`);
// A consumer set that swallowed EVERYTHING would also make the delete-route claim above trivially
// false rather than trivially true, but state it explicitly rather than leaving it inferred.
console.log(`  the split is real, not all-or-nothing  ${consumes.length > 0 && cannot.length > 0} (${consumes.length}/${cannot.length})`);
