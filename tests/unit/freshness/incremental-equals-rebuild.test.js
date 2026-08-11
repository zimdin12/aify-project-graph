// ★★ THE ORACLE THAT DID NOT EXIST: does INCREMENTAL indexing converge to the same graph
// as a CLEAN REBUILD?
//
// graph-senior-dev's scope-4 addendum (2026-08-10), from a negative search across
// tests/unit/freshness and tests/integration:
//
//   "I found NO test that applies the same edit history to two identical repos, refreshes
//    one incrementally, force-rebuilds the other, and compares canonical nodes + edges +
//    unresolved state. The suite can be green while incremental indexing converges to a
//    graph different from a clean rebuild, provided each local assertion still passes."
//
// That is codegraph #1502's shape in our own suite — "complete" being compatible with a
// corpus nobody checked. Every existing freshness test asserts a LOCAL property (this file
// was re-extracted, that classification held). None asserts the GLOBAL one that matters:
// the incremental path is a valid substitute for the full one.
//
// ⇒ Their stated minimum, followed here, because a weaker history cannot exercise the
// stale-edge class: add · change · delete · rename · AND a reference that crosses
// unresolved → resolved.
//
// ⚠ WHAT THIS CANNOT DO: it compares the two graphs, not either against ground truth. If
// both paths share an extraction bug they agree and this stays green. It answers "is
// incremental a faithful substitute", which is the question asked — not "is extraction
// correct", which is a different oracle.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureFresh } from '../../../mcp/stdio/freshness/orchestrator.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoA;
let repoB;

function git(repo, ...args) {
  execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
}

async function initRepo(prefix) {
  const repo = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(repo, 'src'), { recursive: true });
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@t');
  git(repo, 'config', 'user.name', 't');
  return repo;
}

async function commitAll(repo, msg) {
  git(repo, 'add', '-A');
  execFileSync('git', ['-C', repo, 'commit', '-qm', msg], { stdio: 'ignore' });
}

// ── the edit history, applied identically to both repos ────────────────────────────
//
// Step 0 is the baseline both paths start from. Steps 1-4 are the history: the
// incremental repo refreshes after EACH, the rebuild repo only at the end.

async function step0(repo) {
  await writeFile(join(repo, 'src', 'alpha.js'), 'export function alpha() { return helper(); }\n');
  // `helper` does not exist yet → this reference is UNRESOLVED at the baseline.
  await writeFile(join(repo, 'src', 'beta.js'), 'export function beta() { return 2; }\n');
  await writeFile(join(repo, 'src', 'doomed.js'), 'export function doomed() { return 3; }\n');
  await writeFile(join(repo, 'src', 'oldname.js'), 'export function renamedMe() { return 4; }\n');
  await commitAll(repo, 'baseline');
}

const HISTORY = [
  // 1. ADD — and it RESOLVES the dangling reference from the baseline.
  //    This is the crossing graph-senior-dev insisted on: unresolved → resolved.
  async (repo) => {
    await writeFile(join(repo, 'src', 'helper.js'), 'export function helper() { return 1; }\n');
    await commitAll(repo, 'add helper — resolves alpha→helper');
  },
  // 2. CHANGE — body edit that adds a new outgoing call.
  async (repo) => {
    await writeFile(join(repo, 'src', 'beta.js'), 'export function beta() { return helper() + 2; }\n');
    await commitAll(repo, 'change beta — new call edge');
  },
  // 3. DELETE — the reverse crossing: resolved → unresolved for anything pointing at it.
  async (repo) => {
    await writeFile(join(repo, 'src', 'alpha.js'), 'export function alpha() { return helper() + doomed(); }\n');
    await commitAll(repo, 'alpha now calls doomed');
    await unlink(join(repo, 'src', 'doomed.js'));
    await commitAll(repo, 'delete doomed — alpha→doomed becomes unresolved');
  },
  // 4. RENAME — the case that most often leaves stale nodes behind.
  async (repo) => {
    await writeFile(join(repo, 'src', 'newname.js'), 'export function renamedMe() { return 4; }\n');
    await unlink(join(repo, 'src', 'oldname.js'));
    await commitAll(repo, 'rename oldname → newname');
  },
];

// ── canonicalisation ───────────────────────────────────────────────────────────────
//
// Compare STRUCTURE, not bookkeeping. Ids, timestamps and row order are implementation
// detail; what must agree is which symbols exist, where, and what points at what.
function canonicalGraph(dbPath) {
  const db = openDb(dbPath);
  try {
    const nodes = db.all(
      `SELECT type, label, file_path, start_line, end_line, language
       FROM nodes ORDER BY file_path, label, start_line, type`,
    ).map((n) => {
      // The repo ROOT directory node is labelled with the checkout's own folder name, so
      // two temp clones differ there by construction. That is the container, not the
      // graph — normalise it rather than let a fixture artefact masquerade as a
      // divergence. Every other Directory label is a real in-repo path and is compared.
      const label = (n.type === 'Directory' && n.file_path === '.') ? '<repo-root>' : n.label;
      return `${n.type}|${label}|${n.file_path}|${n.start_line}-${n.end_line}|${n.language}`;
    });

    // Edges by ENDPOINT LABELS rather than ids, so a differing id scheme cannot mask or
    // manufacture a difference.
    const edges = db.all(
      `SELECT e.relation AS relation,
              fn.label AS from_label, fn.file_path AS from_file,
              tn.label AS to_label,   tn.file_path AS to_file
       FROM edges e
       LEFT JOIN nodes fn ON fn.id = e.from_id
       LEFT JOIN nodes tn ON tn.id = e.to_id
       ORDER BY relation, from_file, from_label, to_file, to_label`,
    ).map((e) => {
      // Same container normalisation as nodes — the repo-root label reaches edges too,
      // via the CONTAINS edge from root to its subdirectories.
      const from = e.from_file === '.' ? '<repo-root>' : e.from_label;
      const to = e.to_file === '.' ? '<repo-root>' : e.to_label;
      return `${e.relation}|${e.from_file}:${from}|${e.to_file}:${to}`;
    });

    return { nodes, edges };
  } finally {
    db.close();
  }
}

beforeEach(async () => {
  repoA = await initRepo('apg-inc-');
  repoB = await initRepo('apg-full-');
});

afterEach(async () => {
  for (const r of [repoA, repoB]) {
    if (r) { try { await rm(r, { recursive: true, force: true }); } catch { /* windows lock */ } }
  }
});

describe('incremental indexing converges to the same graph as a clean rebuild', () => {
  it('★★★ same edit history → identical canonical nodes and edges', async () => {
    // A: baseline index, then refresh after EVERY step — the incremental path.
    await step0(repoA);
    await ensureFresh({ repoRoot: repoA });
    for (const step of HISTORY) {
      await step(repoA);
      await ensureFresh({ repoRoot: repoA });
    }

    // B: same history applied with NO indexing in between, then ONE clean rebuild.
    await step0(repoB);
    for (const step of HISTORY) await step(repoB);
    await ensureFresh({ repoRoot: repoB, force: true });

    const a = canonicalGraph(join(repoA, '.aify-graph', 'graph.sqlite'));
    const b = canonicalGraph(join(repoB, '.aify-graph', 'graph.sqlite'));

    // Harness sanity FIRST — two empty graphs are trivially equal, which is exactly how
    // this test would rot into a tautology.
    expect(b.nodes.length, 'rebuild must produce a non-trivial graph').toBeGreaterThan(5);
    expect(b.edges.length, 'rebuild must produce edges').toBeGreaterThan(0);

    // The deleted and renamed files must be GONE from both — the stale-node class.
    expect(a.nodes.join('\n')).not.toMatch(/doomed\.js/);
    expect(a.nodes.join('\n')).not.toMatch(/oldname\.js/);

    expect(a.nodes, 'incremental nodes must equal rebuild nodes').toEqual(b.nodes);
    expect(a.edges, 'incremental edges must equal rebuild edges').toEqual(b.edges);
  });

  it('★ and the unresolved sidecar agrees — resolved/unresolved crossings both ways', async () => {
    // The counts are the part a local test cannot see: step 1 RESOLVES alpha→helper and
    // step 3 UNRESOLVES alpha→doomed. An incremental path that fails to re-resolve, or
    // fails to re-dirty, disagrees here while every per-file assertion still passes.
    await step0(repoA);
    await ensureFresh({ repoRoot: repoA });
    for (const step of HISTORY) {
      await step(repoA);
      await ensureFresh({ repoRoot: repoA });
    }
    await step0(repoB);
    for (const step of HISTORY) await step(repoB);
    await ensureFresh({ repoRoot: repoB, force: true });

    const readManifest = async (repo) => JSON.parse(
      await (await import('node:fs/promises')).readFile(join(repo, '.aify-graph', 'manifest.json'), 'utf8'),
    );
    const ma = await readManifest(repoA);
    const mb = await readManifest(repoB);

    expect(ma.dirtyEdgeCount, 'unresolved counts must agree').toBe(mb.dirtyEdgeCount);
    expect(ma.trustDirtyEdgeCount, 'trust-relevant unresolved must agree').toBe(mb.trustDirtyEdgeCount);
    expect(ma.skippedFileCount ?? 0, 'neither path may lose files the other kept').toBe(mb.skippedFileCount ?? 0);
  });
});
