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
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mainRepoWorkspace, openArmWorkspace, disposeArmWorkspace, ARM_WORKTREE_ROOT } from './lib/arm-workspace.mjs';
import {
  findArms, BLOCKS_NEW_RUN, armManifest, writeManifest, writeBeat,
  manifestPathFor, heartbeatPathFor,
} from './lib/arm-isolation.mjs';

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

function runArm({ repo, spec, arm, evidenceDir, subjectCommit, retain, runId }) {
  // ⛔ THE ARM'S OWN DIRECTORY NAME IS PART OF THE INPUT, and naming it after the arm made the two
  // inputs different. Each arm indexes its own worktree, so the worktree ROOT becomes a Directory
  // node — and with `ab-A-...` / `ab-B-...` roots the comparison reported one node present only in
  // arm B that was nothing but the harness labelling itself. A constant leaf under a per-arm parent
  // keeps the paths distinct on disk while the indexed tree is byte-identical.
  const armPath = join(repo, ARM_WORKTREE_ROOT, `ab-${runId}-${arm.name}`, 'subject');
  const failures = [];
  let payload = null;
  let transport = null;
  let governed = null;
  let disposal = null;
  let exitInfo = null;

  // ⛔⛔ THIS LINE USED TO READ `if (existsSync(armPath)) disposeArmWorkspace(...)` UNDER A COMMENT
  // CLAIMING IT FAILED CLOSED. It did the opposite: a prior hard-killed run leaves exactly that
  // path, and the next invocation DELETED it — destroying the mutant evidence of the crash before
  // anything proved the run abandoned. A deterministic path also meant a second harness could delete
  // a FIRST harness's live arm.
  //
  // ⇒ Nothing is disposed on entry. Pre-entry discovery happens once in main(), where any observable
  // arm REFUSES the run outright — matching arm-isolation.mjs, in which every ARM_STATE blocks and
  // only an externally confirmed ORPHAN may ever be deleted. The path carries a per-run id so two
  // harnesses cannot collide on it at all.
  if (existsSync(armPath)) {
    failures.push(`REFUSED: ${armPath} already exists — an observable arm is never disposed automatically`);
    return { name: arm.name, describes: arm.describes, failures, graph: null, counts: null };
  }
  mkdirSync(dirname(armPath), { recursive: true });

  // ⛔ REGISTER BEFORE THE WORKTREE EXISTS, NOT AFTER. This harness consumed findArms for discovery
  // while writing no manifest of its own, so it could see everyone else's arms and nobody could see
  // its own — a concurrent run would have measured straight through a live mutation.
  //
  // ⚠ THE ORDER IS THE WHOLE SAFETY PROPERTY. A manifest written first and removed only after
  // VERIFIED disposal means a kill at any point leaves an observable ORPHAN_CANDIDATE. Registering
  // after creation would leave a window where the worktree exists and nothing declares it.
  const armRunId = `${runId}-${arm.name}`;
  const runToken = randomUUID();
  const manifestPath = manifestPathFor(repo, armRunId);
  const beatPath = heartbeatPathFor(repo, armRunId);
  writeManifest(manifestPath, armManifest({
    runId: armRunId,
    runToken,
    specId: spec.question ?? 'ab-graph-effect',
    target: arm.transport?.file ?? spec.transportFile,
    commit: subjectCommit,
    tree: subjectCommit,
    worktree: armPath,
    pid: process.pid,
  }));
  writeBeat(beatPath, { runToken, seq: 0 });

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
        // ⛔ THE ARM'S OWN WORKER, NOT THE MAIN CHECKOUT'S. This launched
        // `join(repo, 'scripts/ab-arm-worker.mjs')` while hashing the ARM's copy as a governed file
        // — so `governedFileSha256` named bytes that were not the bytes that ran. On a clean subject
        // the two are equal, which is exactly why it survived: the receipt proved the arm copy and a
        // concurrent edit to main could have split them after identity was captured. An identity
        // that is only accidentally correct is not an identity.
        execFileSync(process.execPath, [
          ws.path('scripts/ab-arm-worker.mjs'), ws.root, graphDir, outFile, spec.livenessLabel ?? '',
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

  // ⛔ DE-REGISTER ONLY ON VERIFIED DISPOSAL. If any removal step failed, the manifest and beat STAY,
  // so the next invocation sees an observable arm and refuses rather than measuring over the residue.
  // Removing the registration on the way out regardless would turn a failed cleanup into a silent one.
  if (undisposed.length === 0) {
    rmSync(manifestPath, { force: true });
    rmSync(beatPath, { force: true });
  }

  let membership = null;
  if (payload) {
    const nodes = canonicalise(payload.nodes);
    const edges = canonicalise(payload.edges);
    const keep = retain.has('membership');
    if (keep) {
      writeFileSync(join(evidenceDir, `arm-${arm.name}.nodes.txt`), nodes.text);
      writeFileSync(join(evidenceDir, `arm-${arm.name}.edges.txt`), edges.text);
    }
    membership = {
      // ⚠ `retained: false` means the hash is what a RE-RUN must reproduce, not a file you can open.
      // Saying which is the whole point; a hash that silently names nothing is the defect this
      // policy exists to prevent.
      retained: keep,
      nodesFile: keep ? `arm-${arm.name}.nodes.txt` : null,
      nodesSha256: nodes.hash,
      nodesCount: nodes.count,
      edgesFile: keep ? `arm-${arm.name}.edges.txt` : null,
      edgesSha256: edges.hash,
      edgesCount: edges.count,
    };
  }
  // The worker's intermediate duplicates the membership above; it is never the durable artifact.
  rmSync(join(evidenceDir, `arm-${arm.name}.raw.json`), { force: true });

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

  // ⛔ PRE-ENTRY DISCOVERY: any observable arm REFUSES the run. arm-isolation's BLOCKS_NEW_RUN
  // contains EVERY state on purpose — stale means abandonment is UNPROVED, not proved — and only an
  // externally confirmed orphan is ever deletable. This harness previously swept the path clean on
  // entry instead, which is the exact defect that machinery exists to prevent.
  const observed = findArms(repo).filter((a) => BLOCKS_NEW_RUN.has(a.state));
  if (observed.length > 0 && !argv.includes('--allow-observed-arms')) {
    console.error('REFUSED: observable arm workspaces are present; their staleness does not prove abandonment.');
    observed.forEach((a) => console.error(`  ${a.runId ?? '?'} ${a.state}: ${a.detail ?? ''}`));
    console.error('Resolve them through the custody path (external confirmation + closure) before measuring.');
    return 4;
  }


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
  // ⛔ RETENTION IS A DECLARED POLICY, NOT AN ACCIDENT OF WHAT SURVIVED. Keeping everything would
  // add ~15MB to a repository whose .git is 13MB and whose largest tracked artifact is 178KB — 40x
  // any existing evidence file, for populations that are reproducible from the named subject by the
  // committed harness. Keeping nothing repeats the defect this replaced, where a hash pointed at a
  // temp path.
  //
  // ⇒ So the policy is explicit, and every artifact records whether it was RETAINED. A hash on a
  // discarded file is still useful — it is what a re-run must reproduce — but the reader is told
  // which it is rather than assuming a file is there.
  const retain = new Set(spec.retain ?? ['diffs']);
  const durable = Boolean(spec.evidenceDir);
  // A per-run id, so two harnesses cannot collide on a deterministic arm path.
  const runId = `ab${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const evidenceDir = durable
    ? resolve(repo, spec.evidenceDir)
    : mkdtempSync(join(tmpdir(), 'apg-ab-evidence-'));
  mkdirSync(evidenceDir, { recursive: true });

  const arms = [];
  for (const arm of spec.arms) {
    process.stderr.write(`[ab] arm ${arm.name} …\n`);
    const result = runArm({ repo, spec, arm, evidenceDir, subjectCommit, retain, runId });
    arms.push(result);
    // ⛔ A FAILED DISPOSAL STOPS THE HARNESS. Starting arm B while arm A's registration, directory
    // or mutant may still exist is precisely the custody interval already ruled unsafe — and a
    // `finally` that attempted cleanup is not a closure. Retain what exists; require governed
    // cleanup before another mutation arm runs.
    if (result.failures.some((f) => f.startsWith('disposal incomplete'))) {
      console.error(`[ab] STOPPING: arm ${arm.name} did not reach terminal closure; no further arm will start.`);
      break;
    }
  }

  const failed = arms.filter((a) => a.failures.length > 0);
  const [a, b] = arms;
  const comparison = (a?.graph && b?.graph) ? {
    nodes: diffSets(a.graph.nodes, b.graph.nodes),
    edges: diffSets(a.graph.edges, b.graph.edges),
  } : null;

  let diffEvidence = null;
  if (comparison) {
    // ⛔ ALL FOUR CLAIMED DIFFERENCE SETS, NOT TWO. The receipt asserted `nodesOnlyInA` and
    // `nodesOnlyInB` while only ever writing the EDGE files, so "the set differences are retained"
    // was false for half the populations it claimed — and nobody could check the node counts at all.
    // A retention policy that silently covers some of what it names is worse than none, because the
    // reader has no way to tell which half they are holding.
    const keepDiffs = retain.has('diffs');
    const sets = [
      ['nodes-only-in-A', comparison.nodes.onlyA],
      ['nodes-only-in-B', comparison.nodes.onlyB],
      ['edges-only-in-A', comparison.edges.onlyA],
      ['edges-only-in-B', comparison.edges.onlyB],
    ];
    diffEvidence = { retained: keepDiffs, sets: {} };
    for (const [name, members] of sets) {
      const canon = canonicalise(members);
      if (keepDiffs) writeFileSync(join(evidenceDir, `${name}.txt`), canon.text);
      diffEvidence.sets[name] = {
        count: canon.count,
        file: keepDiffs ? `${name}.txt` : null,
        sha256: canon.hash,
      };
    }
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
    // ⛔ THE CLAIM CEILING TRAVELS WITH THE CLAIM. Both arms junction to the SAME mutable
    // node_modules in the main checkout. That is disclosed in `dependencyTransport`, but disclosure
    // is not a limit: sequential use of one mutable path is not proof its bytes were identical
    // between arms. Nothing here inventories that closure, so the strongest thing this receipt can
    // support is a PAIRED OBSERVATION under one shared dependency carrier — not a hermetic result.
    closure: {
      closureInventoried: false,
      dependencyCarrier: 'shared mutable node_modules junction from the main checkout',
      packageLockSha256: existsSync(join(repo, 'package-lock.json'))
        ? sha256(readFileSync(join(repo, 'package-lock.json'), 'utf8'))
        : null,
      claimCeiling: 'paired observation under one disclosed mutable dependency carrier',
    },
    evidenceDir: durable ? spec.evidenceDir : evidenceDir,
    // ⚠ SAY WHICH IT IS. A hash naming a file nobody kept is a claim, not evidence.
    evidenceRetention: {
      policy: [...retain],
      durableDirectory: durable,
      note: durable
        ? 'retained artifacts are committed with this receipt; a hash with retained:false is what a re-run must reproduce, not a file you can open'
        : 'EPHEMERAL temp directory — nothing here is retained; every hash is a re-run target only',
    },
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
