#!/usr/bin/env node
// A disposable, real-code corpus for measuring this tool against languages we actually target.
//
//   node scripts/testbed.mjs --setup    # shallow-clone, install the server, build each graph
//   node scripts/testbed.mjs --status   # what exists, how big, how many nodes/edges
//   node scripts/testbed.mjs --clean    # delete the whole corpus
//
// WHY REAL REPOSITORIES AND NOT FIXTURES. Every efficacy number this project has produced came from
// its OWN repository, which is dense, JavaScript, and names its documents after their incidents —
// so `ls | grep` answers discovery questions outright. That weakness was named in the A/B gate and
// never addressed. A corpus of third-party code in the languages we target removes it.
//
// ⚠ SHALLOW AND SMALL ON PURPOSE. The host is at 96% disk. `--depth 1`, no submodules, and repos
// chosen for structure rather than size — a caller graph needs real cross-file calls, not a large
// single header.
//
// ⛔ THE LANGUAGE TIERS ARE NOT EQUAL, AND THE CORPUS EXISTS PARTLY TO SHOW THAT:
//
//     cpp / python / typescript   compiler-verified backend (clangd, pyright, ts-langserver)
//     php                         tree-sitter extractor ONLY — no language server
//
// PHP therefore never earns `[lsp✓]`, never returns `exhaustive: true`, and can never license a
// "no callers / safe to delete" claim. It is in the corpus so that gap is measured rather than
// assumed, and so any future PHP backend has a before/after to be judged against.

import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { membershipByLanguage, isRecognisedSource } from './lib/source-languages.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = process.env.APG_TESTBED || 'C:/Docker/apg-testbed';

/**
 * Chosen for STRUCTURE, not popularity: each has real cross-file calls, a public API surface, and
 * enough internal layering that "who calls this" is a question with a non-trivial answer.
 */
// ⛔ THE COMMIT IS DECLARED HERE, AND THAT IS WHAT MAKES THIS A PIN.
//
// Review rejected the previous version: it shallow-cloned each MOVING default branch and then asked
// only whether the checkout could report SOME commit — `r.provenance?.commit && r.provenance?.tree`.
// That is OBSERVED identity, not enforcement of a declared one. Delete and recreate the corpus
// tomorrow and the gate passes happily against four different commits, while every before/after
// built on it silently compares two different populations.
//
// ⇒ "Pinned" meant "has an identity", not "has THE identity". The same wrong-noun error, now in the
// fix for a wrong-noun error, which is why it is spelled out rather than quietly corrected.
const REPOS = [
  {
    name: 'fmt', language: 'cpp', url: 'https://github.com/fmtlib/fmt.git',
    commit: 'e27cc20bd93a4e280fb9268d41cd131069a9c73f',
    tree: 'd1e2972611908589b48e8a24d4871338d09a42f8',
    note: 'headers + src, heavy template use',
  },
  {
    name: 'click', language: 'python', url: 'https://github.com/pallets/click.git',
    commit: '68e7ea7228ca144c52e4d1d282cc09da59f7771f',
    tree: '2955d48825c98fd7dcbc60eb41cf18a952a2c0a3',
    note: 'decorator-driven dispatch, hard for static extraction',
  },
  {
    name: 'fast-route', language: 'php', url: 'https://github.com/nikic/FastRoute.git',
    commit: '1c961398bef1ff6ecd8b273bef651d7afe90312b',
    tree: 'f7c33a29ac1d10b73b9ef6a6bafbec2f453e738c',
    note: 'PHP — heuristic tier only, no language server',
  },
  {
    name: 'p-queue', language: 'typescript', url: 'https://github.com/sindresorhus/p-queue.git',
    commit: '180ab9e25cd10b6f548767d7176076b50d25e188',
    tree: 'e8e63896c7368b45ead03441d007c76f2b2591e5',
    note: 'small TS with real class structure',
  },
];

/**
 * The EXACT untracked paths this tool is permitted to create in a corpus repository.
 *
 * ⛔ TRACKED-CLEAN IS NECESSARY AND NOT SUFFICIENT. An arbitrary untracked `extra.py` passes
 * `sourceUnmodified: true`, gets INDEXED INTO THE GRAPH, and is then excluded from the audit's
 * denominator because that denominator is `git ls-files`. Numerator contaminated, denominator not —
 * a coverage figure quietly measuring a different population than it names.
 *
 * ⇒ Anything untracked and not on this list refuses the arm. A recognised source extension refuses
 * it loudly, because that is the case that corrupts the measurement rather than merely surprising us.
 */
const ALLOWED_ARTIFACTS = Object.freeze(['.aify-graph/', '.claude/', '.mcp.json', '.mcp.json.apg-bak']);
// Source recognition comes from scripts/lib/source-languages.mjs — one owner, so the manifest
// and the audit can never disagree about what counts as source.

const args = new Set(process.argv.slice(2));
const run = (cmd, cmdArgs, cwd) => execFileSync(cmd, cmdArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });

/**
 * ⛔ A CORPUS THAT IS NOT PINNED CANNOT BE RE-MEASURED, AND THE FIRST VERSION WAS NOT PINNED.
 *
 * Review, refusing to accept the audit as before/after authority: this script shallow-cloned MOVING
 * default branches, recorded no clone commit, and reused an existing directory without proving a
 * clean checkout. A later run calling itself "the same corpus" would not mechanically be one, so
 * every before/after comparison built on it would be unfalsifiable.
 *
 * Provenance is therefore recorded per arm — remote, exact commit and tree, branch, and whether the
 * working tree was clean — plus the versions of everything that produced the result.
 */
function provenanceOf(root) {
  const git = (a) => run('git', a, root).trim();

  // ⛔ "CLEAN" MEANT TWO DIFFERENT THINGS AND THE FIRST VERSION PICKED THE WRONG ONE. A plain
  // `git status --porcelain` reported all four arms dirty — but the only entries were artifacts WE
  // add: `.aify-graph/`, `.claude/`, `.mcp.json`. Zero tracked files were modified in any arm.
  //
  // ⇒ What compromises a corpus is a modification to TRACKED SOURCE. Untracked additions by the
  // tool under test are expected, and are recorded rather than ignored so their presence is visible
  // instead of being quietly excluded from the definition.
  let sourceModified = null;
  let addedArtifacts = [];
  let statusCaptureFailed = false;
  try {
    sourceModified = git(['status', '--porcelain', '--untracked-files=no']).length > 0;
    addedArtifacts = git(['status', '--porcelain'])
      .split('\n').map((l) => l.trim()).filter((l) => l.startsWith('??'))
      .map((l) => l.slice(2).trim());
  } catch {
    // ⛔ UNKNOWN MUST REFUSE, NOT PASS. The previous gate read `sourceUnmodified !== false`, and
    // `null` — exactly what this catch produced — sailed through it. The comment said unknown
    // provenance cannot participate in a before/after claim; the predicate granted it anyway.
    statusCaptureFailed = true;
  }

  // Untracked paths that are NOT on the allowlist. A recognised source extension here means the
  // graph may contain nodes the audit denominator will never count.
  const unexpected = addedArtifacts.filter((p) => !ALLOWED_ARTIFACTS.includes(p));
  const unexpectedSource = unexpected.filter((p) => isRecognisedSource(p));
  const submodules = (() => { try { return git(['submodule', 'status']).trim(); } catch { return ''; } })();
  return {
    remote: (() => { try { return git(['remote', 'get-url', 'origin']); } catch { return null; } })(),
    commit: (() => { try { return git(['rev-parse', 'HEAD']); } catch { return null; } })(),
    tree: (() => { try { return git(['rev-parse', 'HEAD^{tree}']); } catch { return null; } })(),
    branch: (() => { try { return git(['rev-parse', '--abbrev-ref', 'HEAD']); } catch { return null; } })(),
    sourceUnmodified: statusCaptureFailed ? null : !sourceModified,
    statusCaptureFailed,
    addedArtifacts,
    unexpectedUntracked: unexpected,
    unexpectedUntrackedSource: unexpectedSource,
    artifactsAllowed: unexpected.length === 0,
    // ⚠ EXACT recursive status, not a count. A count is not identity: an uninitialised gitlink and
    // a correctly-checked-out one both count as 1, and the first is missing source the coverage
    // denominator would never know about.
    submoduleStatus: submodules ? submodules.split('\n').map((s) => s.trim()) : [],
    submoduleCount: submodules ? submodules.split('\n').length : 0,
  };
}

/** What produced the numbers — so a later run can tell whether a delta is the corpus or us. */
function toolchainProvenance() {
  const git = (a) => { try { return run('git', a, REPO).trim(); } catch { return null; } };
  return {
    apgCommit: git(['rev-parse', 'HEAD']),
    apgTree: git(['rev-parse', 'HEAD^{tree}']),
    apgWorkingTreeClean: (() => { const s = git(['status', '--porcelain']); return s === null ? null : s.length === 0; })(),
    node: process.version,
    platform: `${process.platform}:${process.arch}`,
  };
}

function dirSizeMb(p) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else { try { total += statSync(full).size; } catch { /* ignore */ } }
    }
  };
  try { walk(p); } catch { return null; }
  return Math.round(total / 1048576);
}

// ⛔ PATHS TRAVEL BY ENVIRONMENT, NEVER INTERPOLATED INTO AN INLINE `node -e` SCRIPT. The first
// version built the source text with Windows paths embedded and every one of the four repos
// reported "Command failed" with a truncated message — clone and install had succeeded, indexing
// had not, and running the identical call directly worked first time. Backslashes do not survive
// the trip. This project has a standing note about exactly that and I wrote the bug anyway.
const childEnv = (extra) => ({ ...process.env, APG_REPO: REPO.replace(/\\/g, '/'), ...extra });

const COUNT_SRC = `
  import('file:///' + process.env.APG_REPO + '/mcp/stdio/storage/db.js').then(({openExistingDb}) => {
    const d = openExistingDb(process.env.APG_DB);
    console.log(JSON.stringify({ nodes: d.get('SELECT COUNT(*) c FROM nodes').c, edges: d.get('SELECT COUNT(*) c FROM edges').c }));
    d.close();
  });`;

const INDEX_SRC = `
  import('file:///' + process.env.APG_REPO + '/mcp/stdio/query/verbs/index.js')
    .then(m => m.graphIndex({ repoRoot: process.env.APG_TARGET, force: true }))
    .then(() => process.exit(0))
    .catch(e => { console.error(e.message); process.exit(1); });`;

/**
 * How many nodes represent CODE, as opposed to documents, directories and config?
 *
 * ⭐ THIS IS THE POSITIVE CONTROL FOR AN INDEX. An interrupted index leaves a database that exists,
 * opens cleanly, and contains a plausible number of nodes — `click` was left with 90: Document 43,
 * Directory 25, Config 22, and not one Function. Nothing about the file said it was partial.
 */
const CODE_NODE_SRC = `
  import('file:///' + process.env.APG_REPO + '/mcp/stdio/storage/db.js').then(({openExistingDb}) => {
    const d = openExistingDb(process.env.APG_DB);
    const r = d.get("SELECT COUNT(*) c FROM nodes WHERE type IN ('Function','Method','Class','Interface','Type','Symbol','Test')");
    console.log(String(r.c));
    d.close();
  });`;

function codeNodeCount(root) {
  const db = join(root, '.aify-graph', 'graph.sqlite');
  if (!existsSync(db)) return 0;
  try {
    const out = execFileSync(process.execPath, ['-e', CODE_NODE_SRC], {
      encoding: 'utf8', timeout: 60000, env: childEnv({ APG_DB: db.replace(/\\/g, '/') }),
    });
    return Number(out.trim()) || 0;
  } catch { return 0; }
}

function graphCounts(root) {
  const db = join(root, '.aify-graph', 'graph.sqlite');
  if (!existsSync(db)) return null;
  try {
    const out = execFileSync(process.execPath, ['-e', COUNT_SRC], {
      encoding: 'utf8', timeout: 60000, env: childEnv({ APG_DB: db.replace(/\\/g, '/') }),
    });
    return JSON.parse(out.trim());
  } catch { return null; }
}

if (args.has('--clean')) {
  if (!existsSync(CORPUS)) { console.log(JSON.stringify({ action: 'clean', existed: false })); process.exit(0); }
  const before = dirSizeMb(CORPUS);
  rmSync(CORPUS, { recursive: true, force: true, maxRetries: 3 });
  console.log(JSON.stringify({ action: 'clean', removed: CORPUS, freedMb: before, stillExists: existsSync(CORPUS) }, null, 2));
  process.exit(existsSync(CORPUS) ? 1 : 0);
}

if (args.has('--status')) {
  const rows = REPOS.map((r) => {
    const root = join(CORPUS, r.name);
    const present = existsSync(root);
    return {
      name: r.name,
      language: r.language,
      cloned: present,
      installed: present && existsSync(join(root, '.mcp.json')),
      indexed: present && existsSync(join(root, '.aify-graph', 'graph.sqlite')),
      sizeMb: present ? dirSizeMb(root) : null,
      graph: present ? graphCounts(root) : null,
      note: r.note,
    };
  });
  console.log(JSON.stringify({ corpus: CORPUS, exists: existsSync(CORPUS), repos: rows }, null, 2));
  process.exit(0);
}

// ⭐ FAST BINDING CHECK, no clone and no index. Answers only "is the corpus on disk still the
// declared population?" — which is the question every re-measurement must ask first, and which
// nobody will ask if the only way to ask it costs several minutes of re-indexing.
if (args.has('--verify')) {
  const rows = REPOS.map((r) => {
    const root = join(CORPUS, r.name);
    if (!existsSync(root)) return { name: r.name, present: false, pinMatch: null, error: 'not cloned' };
    let observedCommit = null;
    let observedTree = null;
    try {
      observedCommit = run('git', ['rev-parse', 'HEAD'], root).trim();
      observedTree = run('git', ['rev-parse', 'HEAD^{tree}'], root).trim();
    } catch { /* leave null — unknown must refuse, not pass */ }
    const prov = existsSync(root) ? provenanceOf(root) : null;
    return {
      name: r.name,
      present: true,
      declared: { commit: r.commit, tree: r.tree },
      observed: { commit: observedCommit, tree: observedTree },
      pinMatch: { commit: observedCommit === r.commit, tree: observedTree === r.tree },
      sourceUnmodified: prov?.sourceUnmodified ?? null,
      artifactsAllowed: prov?.artifactsAllowed ?? null,
      unexpectedUntracked: prov?.unexpectedUntracked ?? null,
    };
  });
  const toolchain = toolchainProvenance();
  const bound = rows.length === REPOS.length
    && rows.every((r) => r.present && r.pinMatch?.commit === true && r.pinMatch?.tree === true
      && r.sourceUnmodified === true && r.artifactsAllowed === true)
    && toolchain.apgWorkingTreeClean === true;
  console.log(JSON.stringify({ corpus: CORPUS, bound, toolchain, arms: rows }, null, 2));
  process.exit(bound ? 0 : 1);
}

if (!args.has('--setup')) {
  console.error('usage: node scripts/testbed.mjs [--setup | --verify | --status | --clean]');
  process.exit(2);
}

mkdirSync(CORPUS, { recursive: true });
const report = [];

for (const r of REPOS) {
  const root = join(CORPUS, r.name);
  const row = { name: r.name, language: r.language, steps: {} };
  try {
    // ⛔ CHECKOUT THE DECLARED COMMIT, THEN PROVE IT. An existing directory at a DIFFERENT identity
    // is refused rather than silently adopted — that is precisely how "the same corpus" becomes two
    // different populations wearing one name.
    if (!existsSync(root)) {
      run('git', ['clone', '--no-checkout', '--filter=blob:none', '--no-tags', r.url, root], CORPUS);
      run('git', ['fetch', '--depth', '1', 'origin', r.commit], root);
      run('git', ['checkout', '--detach', r.commit], root);
      row.steps.clone = 'cloned at declared commit';
    } else {
      const at = run('git', ['rev-parse', 'HEAD'], root).trim();
      if (at !== r.commit) {
        row.steps.clone = 'REFUSED';
        row.error = `existing checkout is at ${at}, declared pin is ${r.commit} — refusing to adopt a different population`;
        report.push(row);
        continue;
      }
      row.steps.clone = 'already at declared commit';
    }

    // Assert, do not assume. The clone/checkout above can succeed and still leave a different tree
    // if the remote rewrote history under the same ref.
    const observedCommit = run('git', ['rev-parse', 'HEAD'], root).trim();
    const observedTree = run('git', ['rev-parse', 'HEAD^{tree}'], root).trim();
    row.pinMatch = { commit: observedCommit === r.commit, tree: observedTree === r.tree };
    if (!row.pinMatch.commit || !row.pinMatch.tree) {
      row.error = `pin mismatch — observed ${observedCommit}/${observedTree}, declared ${r.commit}/${r.tree}`;
      report.push(row);
      continue;
    }

    run(process.execPath, [join(REPO, 'scripts', 'init-project-mcp.mjs'), '--project-root', root, '--runtime', 'claude-code'], REPO);
    row.steps.install = existsSync(join(root, '.mcp.json')) ? 'ok' : 'FAILED';

    // Index through the same entry point an operator would use.
    execFileSync(process.execPath, ['-e', INDEX_SRC], {
      cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000,
      env: childEnv({ APG_TARGET: root.replace(/\\/g, '/') }),
    });
    // ⛔ EXISTENCE IS NOT SUCCESS FOR A MUTABLE ARTIFACT THAT ALREADY EXISTED.
    //
    // The previous check was `existsSync(graph.sqlite) ? 'ok' : 'FAILED'`, with a comment calling
    // it rigour — "verified by the artifact, not by the command returning". That reasoning is right
    // for an artifact created fresh and wrong here: the database survives a failed run, so its
    // presence proves only that SOME earlier run succeeded.
    //
    // ⚠ TO BE ACCURATE ABOUT WHAT THIS DID AND DID NOT COST: it was NOT the cause of the degraded
    // `click` graph, and this gate was never fooled — `execFileSync` throws on a non-zero child, so
    // a failing index lands in the catch below and fails the arm. I initially reported otherwise
    // and retracted it. The weakness is real but latent: a child that exits 0 having written
    // nothing would slip through.
    //
    // ⇒ The check now asks whether the graph contains CODE, which is what an index is for. A graph
    // holding only Document/Directory/Config nodes is the exact shape an interrupted index leaves
    // behind, and it is indistinguishable from a healthy one by file existence alone.
    const counts = graphCounts(root);
    const codeNodes = codeNodeCount(root);
    row.steps.index = (counts?.nodes > 0 && codeNodes > 0) ? 'ok' : 'FAILED';
    row.indexEvidence = { totalNodes: counts?.nodes ?? null, codeNodes };

    row.sizeMb = dirSizeMb(root);
    row.graph = graphCounts(root);
    // ⭐ PINNED HERE, NOT ASSUMED. Recorded after every step so the manifest describes the tree the
    // graph was actually built from, not the one we intended to clone.
    row.provenance = provenanceOf(root);

    // ⭐ EXACT MEMBERSHIP, NOT COUNTS. Review: a submodule COUNT is not identity, and neither is a
    // file count. Two runs can both report "79 python files" over different sets, and every derived
    // coverage figure would agree while describing different populations. The manifest therefore
    // records WHICH files, sorted, so a later run can diff the population rather than compare a
    // number to a number.
    const trackedNow = run('git', ['ls-files'], root).split('\n').map((x) => x.trim()).filter(Boolean);
    row.recognisedSourceMembership = membershipByLanguage(trackedNow);
    row.recognisedSourceCounts = Object.fromEntries(
      Object.entries(row.recognisedSourceMembership).map(([k, v]) => [k, v.length]),
    );
  } catch (err) {
    // ⚠ CARRY THE CHILD'S STDERR. The first version reported only "Command failed: node -e", which
    // hid the actual cause through two full rebuild cycles — an absolute Windows path handed to a
    // dynamic import needs a file:// URL, and the child said so every time. A diagnostic that names
    // no cause costs more than no diagnostic, because it looks like one.
    const stderr = (err.stderr ? String(err.stderr) : '').trim();
    row.error = (stderr || String(err.message || err)).split('\n').slice(0, 3).join(' | ').slice(0, 300);
  }
  report.push(row);
}

// ⚠ Fails closed on THREE conditions, not one. A corpus is only a corpus if every declared arm is
// present, indexed, AND pinned to an exact commit — an arm whose provenance is unknown cannot
// participate in a before/after claim, however green its index step looks.
// ⛔ EVERY CLAUSE IS STRICT EQUALITY AGAINST TRUE. `!== false` let UNKNOWN through, and unknown is
// what a failed status query produces — the gate would have passed an arm whose cleanliness nobody
// could determine. A gate that accepts "I don't know" as "fine" is not a gate.
const armsPresent = report.length === REPOS.length;
const indexedAll = armsPresent && report.every((r) => !r.error && r.steps.index === 'ok');
const pinnedAll = armsPresent && report.every((r) => r.pinMatch?.commit === true && r.pinMatch?.tree === true);
const cleanAll = armsPresent && report.every((r) => r.provenance?.sourceUnmodified === true);
const artifactsAll = armsPresent && report.every((r) => r.provenance?.artifactsAllowed === true);

// ⛔ THE INSTRUMENT IS PART OF THE RESULT. The previous run reported `apgCommit 76367b5` while the
// executing bytes of this very script were uncommitted — so the named tree was NOT the instrument
// that produced the numbers, and anyone re-running from that tree would get something else.
const toolchain = toolchainProvenance();
const instrumentBound = toolchain.apgWorkingTreeClean === true;

const ok = armsPresent && indexedAll && pinnedAll && cleanAll && artifactsAll && instrumentBound;

console.log(JSON.stringify({
  corpus: CORPUS,
  ok,
  gate: {
    declaredArms: REPOS.length,
    reportedArms: report.length,
    armsPresent,
    indexedAll,
    pinnedAll,
    cleanAll,
    artifactsAll,
    instrumentBound,
    note: ok ? null
      : 'NOT a bindable corpus. Every arm must be present, indexed, at its DECLARED commit and tree, '
        + 'source-unmodified (unknown refuses), free of unexpected untracked paths, and produced by a '
        + 'CLEAN instrument tree. A result from a dirty instrument is diagnostic, never commit-bound.',
  },
  toolchain,
  repos: report,
}, null, 2));
process.exit(ok ? 0 : 1);
