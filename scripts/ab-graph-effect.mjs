// scripts/ab-graph-effect.mjs
//
// Measure what a code change does to the graph, in a form someone else can re-run and check.
//
// ⛔ WHY THIS EXISTS. Review asked twice for an executable A/B carrier and twice the numbers shipped
// as prose. A delta in a commit message is an assertion; the same delta with its arm objects,
// executed-byte hashes, whole-set evidence and disposal protocol is evidence.
//
// ⛔ AND IT ENCODES FIVE WAYS THIS EXPERIMENT HAS ALREADY GONE WRONG HERE, every one of them mine:
//
//   1. THE INPUT MOVED. An earlier A/B compared indexes built before and after a change — but the
//      change ADDED FILES to the repo being indexed, so nodes rose and structural relations drifted.
//   2. THE MUTATION DID NOT REACH THE RUNNING CODE. Both arms ran in ONE process, and Node loads a
//      module once per process, so both executed the startup code. The edit landed on disk, the
//      probe found it there, the file parsed — and the measurement was of nothing. Each arm now runs
//      in its own child process, in its own worktree.
//   3. THE RUN DID NOTHING. An index that skipped the work reads exactly like one that ran and found
//      no difference, so every arm asserts liveness against a control symbol.
//   4. THE MUTATION RAN IN THE MAIN CHECKOUT. The first version wrote the transported file into the
//      working tree and restored it afterwards. A hard kill between the two leaves mutant production
//      bytes in main, and a hash check that only runs after the child returns cannot close that.
//      Arms are disposable detached worktrees now, and main is opened READ-ONLY so a mutation aimed
//      at it throws by construction rather than relying on this file's own discipline.
//   5. THE RECEIPT DID NOT BIND THE EXECUTED BYTES. It named a commit and tree while the run happened
//      on a dirty checkout whose uncommitted files included the harness itself and every source file
//      under measurement. A commit id plus a list of dirty paths is DISCLOSURE, NOT IDENTITY — so
//      this refuses a dirty subject and hashes every governed file as the arm actually executed it.
//
// Usage:  node scripts/ab-graph-effect.mjs --spec <spec.json> [--out <receipt.json>] [--allow-dirty]
// Exit:   0 measured · 1 an arm failed its own checks · 2 bad spec · 3 subject not clean

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mainRepoWorkspace, openArmWorkspace, disposeArmWorkspace, ARM_WORKTREE_ROOT } from './lib/arm-workspace.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// The in-memory set-key separator, mirroring the worker. Never written to a durable file — see
// canonicalise, and the control-byte guard it would otherwise trip.
const SEP = String.fromCharCode(1);

// ── set comparison ────────────────────────────────────────────────────────────

/**
 * ⛔ SETS, NOT TOTALS. Two offsetting differences leave every total unchanged, so a totals
 * comparison can report "no effect" for a graph that changed in both directions.
 */
export function diffSets(a, b) {
  return {
    onlyA: [...a].filter((k) => !b.has(k)),
    onlyB: [...b].filter((k) => !a.has(k)),
    aSize: a.size,
    bSize: b.size,
  };
}

/**
 * ⛔ A COUNT AND TEN SAMPLES DO NOT ESTABLISH SET INCLUSION. The previous receipt asserted
 * `edgesOnlyInB = 0` and committed nothing a reader could check it against, having deleted the
 * scratch that held the populations. Canonical sorted membership, hashed, makes the claim checkable
 * — sorted first so replay order cannot change the hash.
 */
export function canonicalise(members) {
  const sorted = [...members].sort();
  // ⛔ THE DURABLE FORM IS TAB-SEPARATED, NOT THE IN-MEMORY ONE. Set keys join their fields with
  // U+0001 because that byte cannot occur in an id, a label or a path — but this repository has a
  // guard that FAILS on any tracked file containing a raw control byte, so writing the keys verbatim
  // would produce evidence that cannot be committed. Tab is permitted by that guard and is likewise
  // absent from every field here. The hash is of the WRITTEN form, so what a reader recomputes is
  // exactly what they can read.
  const text = `${sorted.map((k) => k.split(SEP).join('\t')).join('\n')}\n`;
  return { text, hash: sha256(text), count: sorted.length };
}

// ── one arm, in its own disposable worktree ───────────────────────────────────

function runArm({ repo, spec, arm, evidenceDir, subjectCommit }) {
  // ⛔ THE ARM'S OWN DIRECTORY NAME IS PART OF THE INPUT, and naming it after the arm made the two
  // inputs different. Each arm indexes its own worktree, so the worktree ROOT becomes a Directory
  // node — and with `ab-A-...` / `ab-B-...` roots the comparison reported one node present only in
  // arm B that was nothing but the harness labelling itself. A constant leaf under a per-arm parent
  // keeps the paths distinct on disk while the indexed tree is byte-identical.
  const armPath = join(repo, ARM_WORKTREE_ROOT, `ab-${arm.name}`, 'subject');
  const failures = [];
  let payload = null;
  let transport = null;
  let governed = null;
  let disposal = null;
  let exitInfo = null;

  // ⛔ Fail closed on a stale registration rather than reusing whatever is already there.
  if (existsSync(armPath)) disposeArmWorkspace(repo, armPath);
  mkdirSync(join(repo, ARM_WORKTREE_ROOT, `ab-${arm.name}`), { recursive: true });

  const opened = openArmWorkspace(repo, subjectCommit, armPath);
  const ws = opened.workspace;
  transport = opened.transport;
  const file = arm.transport?.file ?? spec.transportFile;

  try {
    if (arm.transport?.find) {
      const before = ws.read(file);
      const occurrences = before.split(arm.transport.find).length - 1;
      if (occurrences !== 1) {
        failures.push(`transport find matched ${occurrences} times, expected exactly 1`);
      } else {
        ws.write(file, before.replace(arm.transport.find, arm.transport.replace));
        if (!ws.read(file).includes(arm.transport.probe)) {
          failures.push('probe absent after edit — the mutation did not land');
        }
        try {
          execFileSync(process.execPath, ['--check', ws.path(file)], { stdio: 'pipe' });
        } catch {
          failures.push('mutated file does not parse — an exit code from it would mean nothing');
        }
      }
    }

    // ⛔ EVERY GOVERNED FILE'S EXECUTED BYTES, hashed inside the worktree that ran them. The commit
    // says what the arm started from; these say what it actually executed.
    governed = Object.fromEntries((spec.governedFiles ?? [file]).map((rel) => [rel, sha256(ws.read(rel))]));

    if (failures.length === 0) {
      const graphDir = join(evidenceDir, `graph-${arm.name}`);
      const outFile = join(evidenceDir, `arm-${arm.name}.raw.json`);
      mkdirSync(graphDir, { recursive: true });
      exitInfo = { code: 0, signal: null };
      try {
        execFileSync(process.execPath, [
          join(repo, 'scripts/ab-arm-worker.mjs'), ws.root, graphDir, outFile, spec.livenessLabel ?? '',
        ], { stdio: ['ignore', 'ignore', 'pipe'], timeout: spec.timeoutMs ?? 900000 });
        payload = JSON.parse(readFileSync(outFile, 'utf8'));
      } catch (err) {
        exitInfo = { code: err.status ?? null, signal: err.signal ?? null };
        failures.push(`arm process failed (code=${exitInfo.code} signal=${exitInfo.signal}): ${String(err.stderr ?? err.message).slice(0, 300)}`);
      }
      if (payload && !payload.liveness) {
        failures.push(`liveness failed: no node labelled ${spec.livenessLabel} — the index did not do the work`);
      }
      // The graph file is scratch; the canonical membership written below is the durable evidence.
      rmSync(graphDir, { recursive: true, force: true });
    }
  } finally {
    disposal = disposeArmWorkspace(repo, armPath);
  }

  // ⚠ A partial disposal is reported, not swallowed: a surviving registration blocks the next run.
  const undisposed = (disposal ?? []).filter((d) => !d.ok);
  if (undisposed.length > 0) failures.push(`disposal incomplete: ${JSON.stringify(undisposed)}`);

  let membership = null;
  if (payload) {
    const nodes = canonicalise(payload.nodes);
    const edges = canonicalise(payload.edges);
    writeFileSync(join(evidenceDir, `arm-${arm.name}.nodes.txt`), nodes.text);
    writeFileSync(join(evidenceDir, `arm-${arm.name}.edges.txt`), edges.text);
    membership = {
      nodesFile: `arm-${arm.name}.nodes.txt`,
      nodesSha256: nodes.hash,
      nodesCount: nodes.count,
      edgesFile: `arm-${arm.name}.edges.txt`,
      edgesSha256: edges.hash,
      edgesCount: edges.count,
    };
  }

  return {
    name: arm.name,
    describes: arm.describes,
    worktree: 'disposable detached worktree at the subject commit',
    dependencyTransport: transport,
    probe: arm.transport?.probe ?? null,
    governedFileSha256: governed,
    exit: exitInfo,
    disposal,
    membership,
    counts: payload && {
      nodes: payload.nodes.length,
      edges: payload.edges.length,
      byRelation: payload.byRelation,
      externalByRelation: payload.externalByRelation,
      dirtyEdgeCount: payload.manifest.dirtyEdgeCount,
      trustDirtyEdgeCount: payload.manifest.trustDirtyEdgeCount,
    },
    failures,
    graph: payload && { nodes: new Set(payload.nodes), edges: new Set(payload.edges) },
  };
}

// ── entry point ───────────────────────────────────────────────────────────────

function main(argv) {
  const specPath = argv[argv.indexOf('--spec') + 1];
  if (!specPath || !existsSync(specPath)) {
    console.error('usage: node scripts/ab-graph-effect.mjs --spec <spec.json> [--out <receipt.json>]');
    return 2;
  }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const repo = resolve(spec.repoRoot ?? process.cwd());
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

  // ⛔ MAIN IS OPENED READ-ONLY. Constructing it here is not decoration: it is the object that makes
  // a mutation aimed at the working checkout throw instead of merely being discouraged.
  mainRepoWorkspace(repo);

  const dirtyPaths = git('status', '--porcelain').split(/\r?\n/).filter(Boolean);
  const subjectCommit = git('rev-parse', 'HEAD');
  const subjectTree = git('rev-parse', 'HEAD^{tree}');

  // ⛔ A DIRTY SUBJECT CANNOT BE NAMED. Arms are checked out from `subjectCommit`, so anything
  // uncommitted is NOT in them — a receipt naming that commit would describe code the run did not
  // execute. That is exactly the identity failure this replaces, so it is refused rather than
  // disclosed in a footnote.
  if (dirtyPaths.length > 0 && !argv.includes('--allow-dirty')) {
    console.error('REFUSED: the subject checkout is dirty, so no commit can name what the arms would execute.');
    dirtyPaths.forEach((p) => console.error(`  ${p}`));
    console.error('Commit the harness, spec and source first, then run against that exact object.');
    return 3;
  }

  // ⛔ EVIDENCE MUST BE DURABLE, AND A TEMP PATH IS NOT AN ADDRESS. The first version wrote the
  // membership into an OS temp directory and recorded that path in the receipt — so the hashes named
  // artifacts the next reboot deletes, and a reader had nothing to recompute them against. Review
  // asked for the populations to be RETAINED, and a pointer at scratch is not retention.
  //
  // ⚠ It is still written OUTSIDE the arm worktrees it describes, because those are disposed, and
  // the receipt is committed AFTER the run as a child of the subject — a receipt cannot sit inside
  // the tree it claims already contained it.
  const durable = Boolean(spec.evidenceDir);
  const evidenceDir = durable
    ? resolve(repo, spec.evidenceDir)
    : mkdtempSync(join(tmpdir(), 'apg-ab-evidence-'));
  mkdirSync(evidenceDir, { recursive: true });

  const arms = [];
  for (const arm of spec.arms) {
    process.stderr.write(`[ab] arm ${arm.name} …\n`);
    arms.push(runArm({ repo, spec, arm, evidenceDir, subjectCommit }));
  }

  const failed = arms.filter((a) => a.failures.length > 0);
  const [a, b] = arms;
  const comparison = (a?.graph && b?.graph) ? {
    nodes: diffSets(a.graph.nodes, b.graph.nodes),
    edges: diffSets(a.graph.edges, b.graph.edges),
  } : null;

  let diffEvidence = null;
  if (comparison) {
    const onlyA = canonicalise(comparison.edges.onlyA);
    const onlyB = canonicalise(comparison.edges.onlyB);
    writeFileSync(join(evidenceDir, 'edges-only-in-A.txt'), onlyA.text);
    writeFileSync(join(evidenceDir, 'edges-only-in-B.txt'), onlyB.text);
    diffEvidence = {
      nodesOnlyInA: comparison.nodes.onlyA.length,
      nodesOnlyInB: comparison.nodes.onlyB.length,
      edgesOnlyInA: onlyA.count,
      edgesOnlyInB: onlyB.count,
      edgesOnlyInAFile: 'edges-only-in-A.txt',
      edgesOnlyInASha256: onlyA.hash,
      edgesOnlyInBFile: 'edges-only-in-B.txt',
      edgesOnlyInBSha256: onlyB.hash,
    };
  }

  const receipt = {
    spec: specPath,
    question: spec.question,
    subject: {
      commit: subjectCommit,
      tree: subjectTree,
      cleanAtRun: dirtyPaths.length === 0,
      dirtyPathsDisclosed: dirtyPaths,
    },
    platform: { node: process.version, platform: process.platform, arch: process.arch },
    heldFixed: 'both arms are detached worktrees of the SAME subject commit; only arm A carries the transport',
    evidenceDir: durable ? spec.evidenceDir : evidenceDir,
    // ⚠ SAY WHICH IT IS. A hash naming a file nobody kept is a claim, not evidence.
    evidenceRetention: durable
      ? 'retained alongside this receipt and committed with it'
      : 'EPHEMERAL temp directory — the hashes are reproducible from the subject commit, the files are not retained',
    arms: arms.map(({ graph, ...rest }) => rest),
    comparison: diffEvidence,
    verdict: failed.length > 0 ? 'INVALID — an arm failed its own checks' : 'measured',
  };

  const outPath = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : spec.out;
  if (outPath) {
    mkdirSync(dirname(resolve(repo, outPath)), { recursive: true });
    writeFileSync(resolve(repo, outPath), `${JSON.stringify(receipt, null, 2)}\n`);
    process.stderr.write(`[ab] receipt -> ${outPath}\n`);
    process.stderr.write(`[ab] raw membership retained in ${evidenceDir} (${readdirSync(evidenceDir).length} files)\n`);
  }
  console.log(JSON.stringify(receipt, null, 2));

  if (failed.length > 0) {
    for (const arm of failed) for (const f of arm.failures) console.error(`[ab] ${arm.name}: ${f}`);
    return 1;
  }
  return 0;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exit(main(process.argv.slice(2)));
}
