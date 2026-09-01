// ONE ARM of the pre/post differential. Runs in its OWN process: an earlier A/B in this arc was
// void because both arms shared one process and therefore one module load.
// argv: <codeDir> <corpusDir>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [codeDir, corpusDir] = process.argv.slice(2);

const lspPath = path.join(codeDir, 'mcp/stdio/code-intel/providers/lsp-collect.js');
// CARRIER BINDING: prove the two arms really loaded different code. Without this, "identical"
// cannot be told apart from having run the same build twice.
const carrier = crypto.createHash('sha256').update(fs.readFileSync(lspPath)).digest('hex').slice(0, 16);

const { createTsLangServerProvider } = await import('file:///' + path.join(codeDir, 'mcp/stdio/code-intel/providers/ts-langserver.js').split(path.sep).join('/'));

// Deterministic, natural population: this project's own query verbs, sorted, from the FROZEN corpus.
const rel = 'mcp/stdio/query/verbs';
const files = fs.readdirSync(path.join(corpusDir, rel))
  .filter((f) => f.endsWith('.js')).sort().slice(0, 12).map((f) => rel + '/' + f);

const provider = createTsLangServerProvider();
const out = await provider.collect({ projectRoot: corpusDir, files, operations: ['definitions', 'references'] });

const recs = out?.records ?? [];
const s = out?.session ?? out ?? {};
const snap = s.documentSnapshot ?? null;
const byKind = {};
for (const r of recs) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;

// Membership identity: a stable fingerprint of WHICH symbols were stored, not just how many.
const membership = recs
  .map((r) => [r.kind, r.file, r.line, r.col, r.name ?? r.symbol ?? ''].join('|'))
  .sort();
const membershipHash = crypto.createHash('sha256').update(membership.join('\n')).digest('hex').slice(0, 16);

// Name the records, do not just count them. A 1-record delta is worth nothing until the record is
// IDENTIFIED and the arm is shown DETERMINISTIC — otherwise LSP jitter and a working guard produce
// the same number.
const tag = process.env.ARM_TAG || 'arm';
const outDir = process.env.ARM_OUT || '.';
fs.writeFileSync(path.join(outDir, 'membership-' + tag + '.txt'), membership.join('\n'), 'utf8');
if (Array.isArray(s.unverifiedLocations) && s.unverifiedLocations.length) {
  fs.writeFileSync(path.join(outDir, 'unverified-' + tag + '.json'), JSON.stringify(s.unverifiedLocations, null, 1), 'utf8');
}

// ⛔ REFUSE A VACUOUS ARM. An earlier differential in this arc reported IDENTICAL from two
// CRASHED runs. An arm that produced no records cannot support "unchanged" — it must exit
// non-zero and be excluded, never averaged in as agreement.
if (recs.length === 0) {
  console.log(JSON.stringify({ carrier, VOID: 'arm produced ZERO records', status: s.status ?? null, filesRequested: files.length }));
  process.exit(3);
}

console.log(JSON.stringify({
  carrier, filesRequested: files.length, status: s.status ?? out?.status ?? null,
  records: recs.length, byKind, membershipHash,
  outOfRepoSkipped: s.outOfRepoSkipped ?? null,
  incoherentLocationsRefused: s.incoherentLocationsRefused ?? null,
  unverifiedLocationsExcluded: s.unverifiedLocationsExcluded ?? null,
  positionGuessSkipped: s.positionGuessSkipped ?? null,
  anonymousSkipped: s.anonymousSkipped ?? null,
  snapshot: snap ? { accesses: snap.snapshotAccesses, hits: snap.hits, misses: snap.misses, missPartition: snap.missPartition } : null,
}));
