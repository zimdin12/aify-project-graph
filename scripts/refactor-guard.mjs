// REFACTOR GUARD — prove a slice changed no behaviour, or refuse to say so.
//
// The last refactor proved the server surface unchanged by comparing a `tools/list` payload
// byte-for-byte against a detached pre-refactor worktree. That worked because the payload is a
// pure function of the code. A VERB's output is not: it depends on graph state, on the working
// tree, on git HEAD. Comparing two runs of a verb across a code change only means something if
// everything else was pinned — and "everything else" is exactly what nobody pinned last time.
//
// ⛔ SO THE FIRST JOB OF THIS TOOL IS TO REFUSE. If the graph moved between baseline and verify,
// the comparison is meaningless and reporting a pass would be worse than reporting nothing: it
// would be the two-snapshot defect wearing a green tick. A guard that cannot detect its own
// invalid conditions certifies whatever happened to run.
//
// ⚠ AND THE CORPUS TRAVELS IN THE BASELINE. A digest of results without the inputs that produced
// them cannot be audited — the reader can see two numbers differ and not what differs. Same
// lesson as the selection receipt: membership goes in the body.
//
//   node scripts/refactor-guard.mjs --baseline   # before a slice
//   node scripts/refactor-guard.mjs --verify     # after; exits 1 on any drift
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACT = join(REPO, '.aify-graph', 'refactor-guard-baseline.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');

// ── the carrier: everything the outputs depend on that is NOT the code under test ────────────
//
// If any of this moves, the run is not comparable. Recorded rather than assumed, and compared
// rather than trusted.
function carrier() {
  const dbPath = join(REPO, '.aify-graph', 'graph.sqlite');
  const manifestPath = join(REPO, '.aify-graph', 'manifest.json');
  const out = { graphPresent: existsSync(dbPath) };
  if (out.graphPresent) {
    // Hash the whole DB. It is the population every verb answers from; a size/mtime pair would
    // miss a same-size edit, which is the defect this project has now found three times.
    out.graphSha256 = sha(readFileSync(dbPath));
    out.graphBytes = statSync(dbPath).size;
  }
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    out.indexedCommit = m.commit ?? null;
    out.nodes = m.nodes ?? null;
    out.edges = m.edges ?? null;
  }
  try {
    out.workingTreeDirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).length;
  } catch { out.workingTreeDirty = null; }
  return out;
}

// ── the corpus ───────────────────────────────────────────────────────────────────────────────
//
// Explicit, not sampled. A sampled corpus makes a pass mean "the parts I happened to draw did
// not change", which is a claim about the draw rather than about the code.
const MODES = ['orient', 'plan', 'debug', 'review', 'audit'];
const TARGETS = [
  'graphPacket', 'clampToBudget', 'renderPacketLines', 'openExistingDb', 'graphWhereis',
  'mcp/stdio/query/verbs/packet.js', 'mcp/stdio/query/verbs/whereis.js', 'docs/THE-GOAL.md',
  'nodeText', 'estimateTokens', 'ZZZ_definitely_absent_symbol',
];

async function runCorpus() {
  const { graphPacket } = await import('../mcp/stdio/query/verbs/packet.js');
  const results = [];
  for (const target of TARGETS) {
    for (const mode of MODES) {
      const entry = { target, mode };
      try {
        const out = await graphPacket({ repoRoot: REPO, target, mode });
        const text = typeof out === 'string' ? out : JSON.stringify(out);
        const { stable, excluded } = splitVolatile(text);
        entry.outcome = 'ok';
        entry.bytes = Buffer.byteLength(stable, 'utf8');
        entry.sha256 = sha(stable);
        // The excluded line's SHAPE is pinned even though its VALUE is not. If the snapshot line
        // stops being emitted, or changes format, that is a behaviour change the exclusion must
        // not hide — which is the whole risk of excluding anything.
        entry.volatileLines = excluded.length;
        entry.volatileShapeOk = excluded.every((l) => VOLATILE_LINE.test(l));
      } catch (err) {
        // ⚠ A THROW IS A RESULT, NOT A SKIP. Dropping it would let a slice that starts throwing
        // on one input still report a clean pass over the inputs that survived — the
        // census-with-no-population defect, in the guard.
        entry.outcome = 'threw';
        entry.error = String(err?.message || err).slice(0, 200);
      }
      results.push(entry);
    }
  }
  return results;
}

// ⛔ MY FIRST VERSION HASHED THE WHOLE OUTPUT AGAINST A LIVE, MUTATING REPO, and it reported
// drift immediately — 614 vs 616 bytes on a run with no behaviour change at all. The cause is
// legitimate: every packet carries
//     SNAPSHOT: indexed=<sha> head=<sha> dirty=<n> trust=<tier>
// and `head` moves on every commit while `dirty` moves on every edit. During a refactor both
// change constantly, so the baseline decays as the work proceeds. A guard whose reference drifts
// under the work it is guarding will cry wolf until someone disables it.
//
// ⚠ graph-senior-dev named this class before I hit it: "do not normalize elapsed_ms, HEAD, dirt
// or timestamps generically — a regex scrub is another way to erase a real drift." So this does
// NOT scrub. It excludes ONE named line, records that it excluded it, and gives that line its
// own shape invariant. The exclusion is visible in the artifact rather than silent in a regex.
const VOLATILE_LINE = /^SNAPSHOT: indexed=\S+ head=\S+ dirty=\d+ trust=\S+$/;

function splitVolatile(text) {
  const stable = [];
  const excluded = [];
  for (const line of text.split('\n')) {
    if (VOLATILE_LINE.test(line)) excluded.push(line);
    else stable.push(line);
  }
  return { stable: stable.join('\n'), excluded };
}

const describe = (r) => `${r.target} [${r.mode}]`;

async function main() {
  const mode = process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--baseline') ? 'baseline' : null;
  if (!mode) {
    console.error('usage: node scripts/refactor-guard.mjs --baseline | --verify');
    process.exit(2);
  }

  const now = carrier();
  const results = await runCorpus();

  if (mode === 'baseline') {
    writeFileSync(ARTIFACT, JSON.stringify({ carrier: now, corpusSize: results.length, results }, null, 2));
    const threw = results.filter((r) => r.outcome === 'threw').length;
    console.log(`baseline written: ${results.length} entries (${threw} threw), graph ${now.graphSha256?.slice(0, 12)}`);
    // A baseline where everything throws is not a baseline; it would make any later run "match".
    if (threw === results.length) {
      console.error('REFUSED: every corpus entry threw — this baseline can certify nothing');
      process.exit(1);
    }
    return;
  }

  if (!existsSync(ARTIFACT)) {
    console.error('REFUSED: no baseline. Run --baseline before the slice, not after.');
    process.exit(1);
  }
  const base = JSON.parse(readFileSync(ARTIFACT, 'utf8'));

  // ⛔ THE REFUSAL COMES FIRST. Comparing outputs across a moved graph is comparing two
  // populations and calling the difference a code change.
  const drifted = [];
  // ⚠ `workingTreeDirty` is recorded but deliberately NOT a refusal condition: it changes on
  // every edit of the work being guarded, and its only leak into output is the excluded line
  // above. The GRAPH is a refusal condition, because it is the population every verb answers
  // from and a moved graph makes the comparison meaningless.
  for (const k of ['graphSha256', 'indexedCommit', 'nodes', 'edges']) {
    if (base.carrier[k] !== now.carrier?.[k] && base.carrier[k] !== now[k]) {
      drifted.push(`${k}: baseline ${base.carrier[k]} -> now ${now[k]}`);
    }
  }
  if (drifted.length) {
    console.error('REFUSED: the carrier moved, so this comparison cannot attribute anything to the code.');
    for (const d of drifted) console.error(`  ${d}`);
    console.error('  Re-baseline on the current graph, then slice.');
    process.exit(1);
  }

  if (base.corpusSize !== results.length) {
    console.error(`REFUSED: corpus size changed (${base.corpusSize} -> ${results.length}); the`
      + ' comparison would be over different populations.');
    process.exit(1);
  }

  const byKey = new Map(base.results.map((r) => [describe(r), r]));
  const changes = [];
  for (const r of results) {
    const b = byKey.get(describe(r));
    if (!b) { changes.push(`${describe(r)}: NEW entry absent from baseline`); continue; }
    if (b.outcome !== r.outcome) {
      changes.push(`${describe(r)}: outcome ${b.outcome} -> ${r.outcome}${r.error ? ` (${r.error})` : ''}`);
    } else if (r.outcome === 'ok' && b.sha256 !== r.sha256) {
      changes.push(`${describe(r)}: output changed (${b.bytes} -> ${r.bytes} stable bytes)`);
    } else if (r.outcome === 'ok' && b.volatileLines !== r.volatileLines) {
      // The excluded line disappearing is a behaviour change that the exclusion would otherwise
      // hide. Pinned separately, because an exclusion with no invariant is a blind spot.
      changes.push(`${describe(r)}: snapshot line count changed (${b.volatileLines} -> ${r.volatileLines})`);
    } else if (r.outcome === 'ok' && !r.volatileShapeOk) {
      changes.push(`${describe(r)}: snapshot line no longer matches its pinned shape`);
    }
  }

  if (changes.length) {
    console.error(`BEHAVIOUR CHANGED on ${changes.length} of ${results.length} corpus entries:`);
    for (const c of changes) console.error(`  ${c}`);
    process.exit(1);
  }
  const threw = results.filter((r) => r.outcome === 'threw').length;
  console.log(`unchanged: ${results.length} of ${results.length} corpus entries identical `
    + `(${threw} throw in both baseline and now, which is itself pinned)`);
}

main().catch((err) => { console.error('guard failed:', err); process.exit(2); });
