// scripts/ab-graph-effect.mjs
//
// Measure what a code change does to the graph, in a form someone else can re-run and check.
//
// ⛔ WHY THIS EXISTS. Review asked twice for an executable A/B carrier and twice I shipped the
// numbers in prose. A delta in a commit message is an assertion; the same delta with its arm objects,
// commands, raw counts and reset protocol is evidence. This is the difference between the two.
//
// ⛔ AND IT ENCODES THE THREE WAYS THIS EXPERIMENT HAS GONE WRONG IN THIS REPOSITORY:
//
//   1. THE INPUT MOVED. An earlier A/B compared indexes built before and after a change — but the
//      change ADDED FILES to the repository being indexed, so nodes rose and three structural
//      relations drifted. Nothing was attributable. Here both arms index the SAME working tree and
//      only a named code transport differs.
//   2. THE MUTATION DID NOT LAND. A find/replace that silently matched nothing produces a "no
//      effect" reading indistinguishable from a real null. Every arm asserts its probe is present
//      and that the file still parses before anything is indexed.
//   3. THE RUN DID NOTHING. An index that skipped the work reads exactly like one that ran and found
//      no difference. Every arm asserts liveness against a control symbol it knows is there.
//
// Usage:  node scripts/ab-graph-effect.mjs --spec <spec.json> [--out <receipt.json>]
// Exit:   0 measured · 1 arm failed (mutation, parse, liveness or reset) · 2 bad spec

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// ── the code transport ────────────────────────────────────────────────────────

/**
 * One arm's edit to the working tree, and its own undo.
 *
 * ⚠ THE RESET IS VERIFIED BY HASH, NOT ASSUMED. A harness that leaves a mutation behind poisons
 * every measurement after it, including ones taken by someone else later in the day.
 */
class CodeToggle {
  constructor(repoRoot, transport) {
    this.path = join(repoRoot, transport.file);
    this.transport = transport;
    this.original = null;
    this.originalHash = null;
  }

  apply() {
    this.original = readFileSync(this.path, 'utf8');
    this.originalHash = sha256(this.original);
    if (!this.transport.find) return { applied: true, note: 'baseline — no edit' };
    const occurrences = this.original.split(this.transport.find).length - 1;
    if (occurrences !== 1) {
      return { applied: false, note: `find matched ${occurrences} times, expected exactly 1` };
    }
    writeFileSync(this.path, this.original.replace(this.transport.find, this.transport.replace));
    return { applied: true, note: 'edit written' };
  }

  /** Did the edit actually reach the file? A probe absent here means the arm proves nothing. */
  landed() {
    if (!this.transport.probe) return true;
    return readFileSync(this.path, 'utf8').includes(this.transport.probe);
  }

  parses() {
    try {
      execFileSync(process.execPath, ['--check', this.path], { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  revert() {
    if (this.original === null) return { reset: true, note: 'nothing to undo' };
    writeFileSync(this.path, this.original);
    const now = sha256(readFileSync(this.path, 'utf8'));
    return { reset: now === this.originalHash, note: now === this.originalHash ? 'byte-identical' : 'RESTORE MISMATCH' };
  }
}

// ── set comparison ────────────────────────────────────────────────────────────

// ⛔ AN EXPLICIT DELIMITER, NOT AN INVISIBLE ONE. This was a literal U+0001 byte in the source:
// correct, but unreadable and one lint pass or editor normalisation away from silently becoming
// an empty string - at which point id 'a' + type 'b' and id 'ab' + type '' collide, two
// different rows compare equal, and the diff under-reports without any error.
const SEP = String.fromCharCode(1);

/**
 * ⛔ SETS, NOT TOTALS. Two offsetting differences leave every total unchanged, so a totals
 * comparison can report "no effect" for a graph that changed in both directions.
 */
export function diffSets(a, b) {
  const onlyA = [...a].filter((k) => !b.has(k));
  const onlyB = [...b].filter((k) => !a.has(k));
  return { onlyA, onlyB, sameSize: a.size === b.size, aSize: a.size, bSize: b.size };
}

// ── one arm ───────────────────────────────────────────────────────────────────

async function runArm({ repoRoot, spec, arm, workDir }) {
  const toggle = new CodeToggle(repoRoot, arm.transport ?? { file: spec.transportFile });
  const applied = toggle.apply();
  const failures = [];
  if (!applied.applied) failures.push(`mutation did not apply: ${applied.note}`);
  if (applied.applied && !toggle.landed()) failures.push('probe absent after edit — the mutation did not land');
  if (applied.applied && !toggle.parses()) failures.push('mutated file does not parse — an exit code here would mean nothing');

  let payload = null;
  if (failures.length === 0) {
    const graphDir = join(workDir, `graph-${arm.name}`);
    const outFile = join(workDir, `arm-${arm.name}.json`);
    rmSync(graphDir, { recursive: true, force: true });
    mkdirSync(graphDir, { recursive: true });
    // ⛔ A CHILD PROCESS, NOT AN IMPORT. Node loads a module once per process, so a parent that
    // imported the orchestrator would run every arm against the code as it was at STARTUP — the edit
    // would be on disk, the probe would find it, and the measurement would be of nothing. Two runs
    // of this harness reported a clean zero that way before the boundary was added.
    try {
      execFileSync(process.execPath, [
        join(repoRoot, 'scripts/ab-arm-worker.mjs'), repoRoot, graphDir, outFile, spec.livenessLabel ?? '',
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      payload = JSON.parse(readFileSync(outFile, 'utf8'));
    } catch (err) {
      failures.push(`arm process failed: ${String(err.stderr ?? err.message).slice(0, 300)}`);
    }
    if (payload && !payload.liveness) {
      failures.push(`liveness failed: no node labelled ${spec.livenessLabel} — the index did not do the work`);
    }
  }

  const reverted = toggle.revert();
  if (!reverted.reset) failures.push(`RESET FAILED: ${reverted.note} — the working tree is dirty`);

  return {
    name: arm.name,
    describes: arm.describes,
    mutation: applied.note,
    probe: arm.transport?.probe ?? null,
    reset: reverted.note,
    counts: payload && {
      nodes: payload.nodes.length,
      edges: payload.edges.length,
      byRelation: payload.byRelation,
      externalByRelation: payload.externalByRelation,
      dirtyEdgeCount: payload.manifest.dirtyEdgeCount,
      trustDirtyEdgeCount: payload.manifest.trustDirtyEdgeCount,
    },
    indexedCommit: payload?.manifest?.commit ?? null,
    failures,
    graph: payload && { nodes: new Set(payload.nodes), edges: new Set(payload.edges) },
  };
}

// ── entry point ───────────────────────────────────────────────────────────────

async function main(argv) {
  const specPath = argv[argv.indexOf('--spec') + 1];
  if (!specPath || !existsSync(specPath)) {
    console.error('usage: node scripts/ab-graph-effect.mjs --spec <spec.json> [--out <receipt.json>]');
    return 2;
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const repoRoot = resolve(spec.repoRoot ?? process.cwd());
  const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : spec.out;

  // ⛔ NAME THE EXACT OBJECTS. "HEAD" is a moving label; an arm named by it cannot be replayed. The
  // dirty flag matters just as much: a tree with uncommitted edits is not the commit it claims.
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  const identity = {
    commit: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    dirtyPaths: git('status', '--porcelain').split(/\r?\n/).filter(Boolean),
  };

  // ⛔ THE SCRATCH GRAPHS MUST LIVE OUTSIDE THE REPOSITORY BEING INDEXED. The first run of this
  // harness put them under the repo root, so arm A's graph directory was still on disk when arm B
  // indexed and showed up as CONTAINS edges on its own manifest.json — arm B saw 4 nodes arm A did
  // not. That is confound #1 from the header, committed by the very harness that names it. The
  // receipt still belongs in the repo; the scratch does not.
  const workDir = spec.workDir
    ? resolve(spec.workDir)
    : mkdtempSync(join(tmpdir(), 'apg-ab-'));
  mkdirSync(workDir, { recursive: true });

  const arms = [];
  for (const arm of spec.arms) {
    process.stderr.write(`[ab] arm ${arm.name} …\n`);
    arms.push(await runArm({ repoRoot, spec, arm, workDir }));
  }

  const failed = arms.filter((a) => a.failures.length > 0);
  const [a, b] = arms;
  const comparison = (a?.graph && b?.graph) ? {
    nodes: diffSets(a.graph.nodes, b.graph.nodes),
    edges: diffSets(a.graph.edges, b.graph.edges),
  } : null;

  const receipt = {
    spec: specPath,
    question: spec.question,
    identity,
    // ⚠ An arm's numbers are only comparable to the other arm's because the TREE was held fixed and
    // only the transport differed. That invariant is recorded, not assumed.
    heldFixed: 'working tree; both arms index the same files, differing only by the named transport',
    arms: arms.map(({ graph, ...rest }) => rest),
    comparison: comparison && {
      nodesOnlyInA: comparison.nodes.onlyA.length,
      nodesOnlyInB: comparison.nodes.onlyB.length,
      edgesOnlyInA: comparison.edges.onlyA.length,
      edgesOnlyInB: comparison.edges.onlyB.length,
      sampleEdgesOnlyInA: comparison.edges.onlyA.slice(0, 10).map((k) => k.split(SEP)),
      sampleEdgesOnlyInB: comparison.edges.onlyB.slice(0, 10).map((k) => k.split(SEP)),
    },
    verdict: failed.length > 0 ? 'INVALID — an arm failed its own checks' : 'measured',
  };

  if (outPath) {
    mkdirSync(dirname(resolve(repoRoot, outPath)), { recursive: true });
    writeFileSync(resolve(repoRoot, outPath), `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(`[ab] receipt -> ${outPath}\n`);
  }
  console.log(JSON.stringify(receipt, null, 2));

  rmSync(workDir, { recursive: true, force: true });

  if (failed.length > 0) {
    for (const arm of failed) for (const f of arm.failures) console.error(`[ab] ${arm.name}: ${f}`);
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
