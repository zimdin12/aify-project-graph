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
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── The authority assignment for packet.js, pre-registered ───────────────────────────────────
//
// One tag per declaration. A declaration in two tags is a defect the check reports; a
// declaration in none is the same defect from the other side.
const PACKET = 'mcp/stdio/query/verbs/packet.js';

const AUTHORITIES = {
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
    why: 'the symbol/pointer route — exact/floor/unknown population branches, file-vs-symbol '
      + 'behaviour. dev: the first high-value falsifier and most repeated route defects',
    declarations: [
      'countByLanguage', 'resolveFeatureForSymbolCheap', 'buildSymbolPointerPacket',
      'resolvePopulation',
    ],
  },
  'packet:facade': {
    why: 'orchestration and the ONLY exported tool entry. dev: withSealScope + sealPacketOutput '
      + 'stays here and graphPacketInner stays non-exported',
    declarations: ['graphPacketInner', 'graphPacket'],
  },
};

// ── Extraction: top-level declarations, by shape rather than by a hand list ───────────────────
//
// ⚠ Deliberately anchored to column 0. A nested helper is not a top-level declaration and must
// not inflate the denominator — a bigger denominator makes the same assignment look better.
const DECL_RE = /^(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)|^(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/;

export function topLevelDeclarations(source) {
  const found = [];
  for (const line of source.split('\n')) {
    const m = DECL_RE.exec(line);
    if (m) found.push(m[1] || m[2]);
  }
  return found;
}

export function auditFile(relPath, authorities) {
  const source = readFileSync(join(REPO, relPath), 'utf8');
  const declared = topLevelDeclarations(source);

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

const r = auditFile(PACKET, AUTHORITIES);
const check = process.argv.includes('--check');

console.log(`\n${r.file}`);
console.log(`  lines ${r.lines}  (descriptive only — this number grants nothing)`);
console.log(`  declarations assigned: ${r.assigned}/${r.total}`);
console.log(`  authorities: ${Object.keys(AUTHORITIES).length}`);
if (r.unassigned.length) console.log(`  ⛔ UNASSIGNED (${r.unassigned.length}): ${r.unassigned.join(', ')}`);
if (r.duplicated.length) console.log(`  ⛔ DUPLICATED: ${r.duplicated.join(' | ')}`);
if (r.phantom.length) console.log(`  ⛔ PHANTOM (assigned but absent): ${r.phantom.join(', ')}`);
console.log(`  complete: ${r.complete}`);

for (const [tag, spec] of Object.entries(AUTHORITIES)) {
  console.log(`\n  ${tag}  (${spec.declarations.length})`);
  console.log(`    ${spec.why}`);
}

if (check && !r.complete) process.exit(1);
