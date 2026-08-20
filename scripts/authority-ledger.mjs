// THE DENOMINATOR THAT `067e3ad` DID NOT HAVE.
//
// That commit was titled "TARGET MET" against the target "no file over ~710 lines". At that
// exact commit fourteen files exceeded it. The claim had no population, so nothing could
// contradict it.
//
// graph-senior-dev's replacement target, which this measures:
//
//   > Every top-level declaration belongs to exactly one named authority; every named guarantee
//   > has exactly one owner module whose public API is sufficient to execute a hostile
//   > counterexample; authority modules do not import their facade.
//
// ⇒ Completion for a file is `assigned === total && duplicated === 0 && unassigned === 0`.
// Line count is reported DESCRIPTIVELY and grants nothing — it is the number that produced the
// false claim, so it may be looked at and never satisfied.
//
// ⚠ THE ASSIGNMENT IS WRITTEN DOWN BEFORE THE MOVE, ON PURPOSE. If the implementation assigns
// authorities after extracting, the extraction defines its own denominator and any arrangement
// scores 100%.
//
//   node scripts/authority-ledger.mjs            # report
//   node scripts/authority-ledger.mjs --check    # exit 1 on unassigned/duplicated
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { topLevelDeclarations } from './lib/module-graph.mjs';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── The authority assignment for packet.js, pre-registered ───────────────────────────────────
//
// One tag per declaration. A declaration in two tags is a defect the check reports; a
// declaration in none is the same defect from the other side.
const PACKET = 'mcp/stdio/query/verbs/packet.js';

export const AUTHORITIES = {
  'packet:input': {
    // ⚠ `hasCodeIntelCollection` was MISSING from my first pre-registration and the ledger
    // caught it on its first run — 43/44. That is the whole reason the assignment is written
    // before the move: had I tagged authorities after extracting, this function would have
    // landed wherever it fell and the count would still have read 100%.
    // It probes the DB rather than reading a file, so the `why` is widened to say so rather
    // than filed under a description that does not cover it.
    why: 'reads the on-disk artifacts and DB availability probes a packet is assembled from; '
      + 'decides nothing about presentation',
    declarations: [
      'loadJsonSafe', 'readBrief', 'readFunctionality', 'readTasks', 'readManifest',
      'hasCodeIntelCollection',
    ],
  },
  'packet:snapshot': {
    why: 'renders the trust/freshness header; its inputs are git and the manifest, not the graph',
    declarations: ['safeGitHead', 'safeDirtyCount', 'trustTier', 'snapshotLine', 'shortSha'],
  },
  'packet:budget': {
    why: 'decides how much output is allowed and which mode shape applies',
    declarations: [
      'DEFAULTS', 'CHAR_PER_TOKEN_EST', 'PACKET_MODES', 'MODE_OVERRIDES', 'esTokens',
      'resolvePacketBudget', 'normalizeMode', 'optionsForMode',
    ],
  },
  'packet:target': {
    why: 'turns a caller string into a resolved overlay entity',
    declarations: ['parseTarget', 'findFeature', 'findTask'],
  },
  'packet:overlay': {
    why: 'reads fields off features/tasks and builds their packet bodies',
    declarations: [
      'readFirstFromFeature', 'readFirstFromTask', 'contractsFromFeature', 'testsFromFeature',
      'risksForFeature', 'risksForTask', 'modeRisks', 'buildFeaturePacket', 'buildTaskPacket',
    ],
  },
  'packet:legacy-clamp': {
    why: 'the TEXT budget clamp. ⚠ dev: do not conflate with the occurrence clamp — production '
      + 'uses clampOccurrences; this is a compatibility/test surface with different safety',
    declarations: [
      'findSectionRange', 'skeletonizeSection', 'collapseSectionToCount', 'clampToBudget',
    ],
  },
  'packet:live': {
    why: 'time-bounded enrichment from other verbs',
    declarations: ['LIVE_BUDGET_MS', 'withTimeout', 'enrichLive'],
  },
  'packet:symbol-route': {
    why: 'the symbol-route DATA helpers — population attestation and the cheap symbol->feature '
      + 'resolution. dev: the first high-value falsifier and most repeated route defects',
    declarations: ['countByLanguage', 'resolveFeatureForSymbolCheap', 'resolvePopulation'],
  },
  'packet:symbol-route-facade': {
    // ⛔ SPLIT FROM THE AUTHORITY ABOVE, deliberately. `buildSymbolPointerPacket` returns a
    // SERIALIZED string via renderPacketLines, so it cannot leave the facade without creating the
    // unsealed-renderer escape dev pre-registered. Its authority is therefore rendering, not
    // symbol resolution, and the ledger says so rather than leaving it filed with the data
    // helpers it happens to call.
    why: 'renders the symbol pointer packet. Stays in packet.js because its output is serialized '
      + 'and must pass the facade seal — dev ruling, slice 2 option (1)',
    declarations: ['buildSymbolPointerPacket'],
  },
  'packet:facade': {
    why: 'orchestration and the ONLY exported tool entry. dev: withSealScope + sealPacketOutput '
      + 'stays here and graphPacketInner stays non-exported',
    declarations: ['graphPacketInner', 'graphPacket'],
  },
};

// ⛔ THE PARSER WAS NARROWER THAN THE CLAIM IT ENFORCED. graph-senior-dev: "the published claim
// says EVERY top-level declaration, while the regex only recognizes function/class/const and can
// be evaded by `let`, `var`, destructuring, generator/default declarations." 44/44 happened to be
// true for the shapes present; the enforcement claim was broader than its instrument, which is
// the same defect as a coverage figure over a population the checker cannot see.
// ⇒ TypeScript AST. See scripts/lib/module-graph.mjs.

export function auditFile(relPath, authorities) {
  const source = readFileSync(join(REPO, relPath), 'utf8');
  const declared = topLevelDeclarations(source, relPath);

  const owner = new Map();
  const duplicated = [];
  for (const [tag, spec] of Object.entries(authorities)) {
    for (const name of spec.declarations) {
      if (owner.has(name)) duplicated.push(`${name} claimed by ${owner.get(name)} and ${tag}`);
      else owner.set(name, tag);
    }
  }

  const unassigned = declared.filter((n) => !owner.has(n));
  // An assignment naming something the file does not contain is the mirror defect: it inflates
  // coverage with declarations that do not exist.
  const declaredSet = new Set(declared);
  const phantom = [...owner.keys()].filter((n) => !declaredSet.has(n));

  return {
    file: relPath,
    lines: source.split('\n').length,
    total: declared.length,
    assigned: declared.length - unassigned.length,
    unassigned,
    duplicated,
    phantom,
    complete: unassigned.length === 0 && duplicated.length === 0 && phantom.length === 0,
  };
}

// ⛔ THE SUITE DID NOT ENFORCE THIS DENOMINATOR, and dev proved it: they added an unassigned
// export, the audit printed 9/10 and ALL FILES COMPLETE: false, and the vitest case still passed
// 7/7 — because it asserted only `typeof auditFile === 'function'`. Importing a script that
// PRINTS a failure is not an assertion.
// ⇒ auditAll() is side-effect-free and returns a verdict. The CLI and the suite call the SAME
// function, so a failure cannot print itself green.
export const FILE_AUTHORITIES = {
  'mcp/stdio/query/verbs/packet.js': ['packet:symbol-route-facade', 'packet:facade'],
  'mcp/stdio/query/verbs/packet-text-budget.js': ['packet:legacy-clamp'],
  'mcp/stdio/query/verbs/packet-live.js': ['packet:live'],
  'mcp/stdio/query/verbs/packet-symbol.js': ['packet:symbol-route'],
  'mcp/stdio/query/verbs/packet-input.js': ['packet:input', 'packet:snapshot', 'packet:budget', 'packet:target'],
  'mcp/stdio/query/verbs/packet-overlay.js': ['packet:overlay'],
};

export function auditAll() {
  const files = Object.entries(FILE_AUTHORITIES)
    .map(([f, tags]) => auditFile(f, Object.fromEntries(tags.map((t) => [t, AUTHORITIES[t]]))));
  return { files, complete: files.every((f) => f.complete) };
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────
// Guarded: importing this module from a test runs nothing and exits nothing.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = auditAll();
  for (const a of result.files) {
    console.log(`
${a.file}`);
    console.log(`  lines ${a.lines}  (descriptive only — this number grants nothing)`);
    console.log(`  declarations assigned: ${a.assigned}/${a.total}`);
    if (a.unassigned.length) console.log(`  ⛔ UNASSIGNED (${a.unassigned.length}): ${a.unassigned.join(', ')}`);
    if (a.duplicated.length) console.log(`  ⛔ DUPLICATED: ${a.duplicated.join(' | ')}`);
    if (a.phantom.length) console.log(`  ⛔ PHANTOM: ${a.phantom.join(', ')}`);
    console.log(`  complete: ${a.complete}`);
  }
  console.log(`
ALL FILES COMPLETE: ${result.complete}`);
  if (process.argv.includes('--check') && !result.complete) process.exit(1);
}
