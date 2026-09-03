// IS ANY OF THE 1057 B LITERALLY REDUNDANT?
//
// Last cycle measured the absence caveat surface at 1057 B — 2.4x the warning wall this project
// removed once — and I declined to trim, on the grounds that choosing WHICH clause to cut depends on
// what agents actually read, which I have not measured and cannot decide alone.
//
// ⭐ THAT REASONING HOLDS FOR CONTENT AND NOT FOR DUPLICATION. Text repeated verbatim, and two
// different clauses filed under one label, are defects whatever a reader prefers. Removing them
// needs no theory of the reader. So this looks for exactly those, and nothing else.
//
// PREREGISTERED, before the run:
//   POPULATION   the assembled worst-case absence surface (cpp + an uncommitted source), and the
//                same for javascript — the two shapes the budget gate already pins.
//   IDENTITY RULE
//     REDUNDANCY      a sequence of >= 6 words occurring more than once in the surface.
//     LABEL COLLISION an "ALLCAPS:" label occurring more than once with DIFFERENT text after it.
//   FINDING SCHEMA  {kind, text, occurrences}
//   CLAIM CEILING   TEXTUAL duplication only. Two clauses that say the same thing in different
//                   words are NOT detected, and no claim of semantic overlap may be made from this.
//   CONTROLS (same pass)
//     POSITIVE  a surface with an INJECTED duplicate phrase must be flagged — else a clean result
//               means only that the detector is broken.
//     NEGATIVE  a surface built from distinct sentences must report nothing.
import { fileURLToPath } from 'node:url';

const say = (...a) => console.log(...a);
const { buildAbsenceTrustLine } = await import('../mcp/stdio/query/lsp-evidence.js');

const db = {
  get: () => ({ c: 932 }),
  all: () => [],
  raw: { prepare: () => ({ all: () => [], get: () => null }) },
};

const MIN_WORDS = 6;

function repeatedPhrases(text, minWords = MIN_WORDS) {
  const words = text.split(/\s+/).filter(Boolean);
  const seen = new Map();
  const hits = new Map();
  for (let i = 0; i + minWords <= words.length; i += 1) {
    const phrase = words.slice(i, i + minWords).join(' ');
    if (seen.has(phrase)) hits.set(phrase, (hits.get(phrase) ?? 1) + 1);
    else seen.set(phrase, i);
  }
  // Keep only maximal phrases: drop any that is a substring of another hit.
  const all = [...hits.keys()];
  return all
    .filter((p) => !all.some((q) => q !== p && q.includes(p)))
    .map((p) => ({ kind: 'repeated phrase', text: p, occurrences: hits.get(p) + 0 }));
}

function labelCollisions(text) {
  const out = [];
  const re = /\b([A-Z][A-Z ]{2,}):/g;
  const byLabel = new Map();
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].trim();
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40).trim();
    const list = byLabel.get(label) ?? [];
    list.push(after);
    byLabel.set(label, list);
  }
  for (const [label, afters] of byLabel) {
    if (afters.length > 1 && new Set(afters).size > 1) {
      out.push({ kind: 'label collision', text: label, occurrences: afters.length });
    }
  }
  return out;
}

// ---- CONTROLS -------------------------------------------------------------------------------
const dupe = 'this absence is within that scope not a statement about the repository';
const posSurface = `alpha ${dupe} beta gamma delta ${dupe} epsilon`;
const posOk = repeatedPhrases(posSurface).length > 0;
const negSurface = 'one two three four five six seven eight nine ten eleven twelve thirteen';
const negOk = repeatedPhrases(negSurface).length === 0;
say(`[${posOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: an injected duplicate phrase is detected`);
say(`[${negOk ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: distinct text reports nothing`);
const colPosOk = labelCollisions('SCOPE: alpha beta. SCOPE: gamma delta.').length === 1;
const colNegOk = labelCollisions('SCOPE: alpha beta. TRUST: gamma delta.').length === 0;
say(`[${colPosOk ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: two different clauses under one label are flagged`);
say(`[${colNegOk ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: distinct labels are not`);
if (!posOk || !negOk || !colPosOk || !colNegOk) {
  say('⛔ CONTROLS FAILED — conclude nothing.');
  process.exit(2);
}

// ---- MEASURE --------------------------------------------------------------------------------
const SURFACES = [
  ['cpp + uncommitted (worst case)', { noun: 'callers', db, language: 'cpp',
    freshness: { uncommittedSources: [{ path: 'src/a.js', why: 'untracked' }] } }],
  ['javascript, clean tree', { noun: 'callers', db, language: 'javascript' }],
];

// ⛔ THE COMPOSED LINE IS NOT THE WHOLE SURFACE, and my first population made that mistake. The
// SECOND `SCOPE:` clause an agent actually sees — "this verb searched the strict call graph ... and
// did NOT search REFERENCES" — is emitted by the VERB, not by buildAbsenceTrustLine. Measuring only
// the composed line cannot see the label collision that is visible in a live answer, which is the
// finding this probe exists to check.
const { graphCallers } = await import('../mcp/stdio/query/verbs/callers.js');
const { openExistingDb } = await import('../mcp/stdio/storage/db.js');
const { join } = await import('node:path');
const liveDb = openExistingDb(join(process.cwd(), '.aify-graph', 'graph.sqlite'));
let orphan = null;
try {
  orphan = liveDb.get(`
    SELECT n.label FROM nodes n
    WHERE n.type = 'Function' AND n.label != ''
      AND NOT EXISTS (SELECT 1 FROM edges e WHERE e.to_id = n.id AND e.relation = 'CALLS')
    ORDER BY n.label LIMIT 1
  `)?.label ?? null;
} finally { liveDb.close?.(); }
const liveText = orphan ? String(await graphCallers({ repoRoot: process.cwd(), symbol: orphan })) : null;
if (liveText) SURFACES.push([`LIVE answer via graph_callers("${orphan}")`, null, liveText]);
else say('⚠ no callerless symbol found — the LIVE arm is SKIPPED, not silently passed');

let total = 0;
for (const [label, args, preBuilt] of SURFACES) {
  const surface = preBuilt ?? await buildAbsenceTrustLine(args);
  const findings = [...repeatedPhrases(surface), ...labelCollisions(surface)];
  total += findings.length;
  say('');
  say(`=== ${label}   ${surface.length} B`);
  if (findings.length === 0) { say('    no literal redundancy found'); continue; }
  for (const f of findings) {
    say(`    ${f.kind.padEnd(16)} x${f.occurrences}  ${JSON.stringify(f.text).slice(0, 110)}`);
  }
}

say('');
say(total === 0
  ? 'VERDICT: no literal redundancy. Any trim would be a judgement about content, which this does not license.'
  : `⛔ VERDICT: ${total} literal redundancy finding(s). These can be removed without a theory of the reader.`);
process.exitCode = total === 0 ? 0 : 1;
