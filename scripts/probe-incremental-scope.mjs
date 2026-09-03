// HOW MUCH DOES ONE EDIT COST, AND HOW MANY FILES DOES IT TOUCH?
//
// ⛔ WHY THIS MATTERS BEYOND THE WATCHER. `scripts/reindex.mjs` runs this same `ensureFresh` from
// post-commit / post-merge / post-checkout / post-rewrite. If a single-file edit takes a
// full-rebuild-shaped path, that cost is paid on EVERY COMMIT by every install — not just by the
// opt-in watcher users.
//
// The motivating observation: RUN-sustained-edit-cost.txt recorded ONE catch-up sync of 53,097 ms
// against a single-burst structural baseline of 42 ms and a full rebuild of 67,268 ms on the same
// clone. That is close enough to a full rebuild to suspect one, and suspicion is not a finding.
//
// PREREGISTERED, before the run:
//   The discriminator is `processedFiles.length` against the number of File nodes in the graph.
//   - one-edit incremental processes a SMALL FRACTION  => incremental is scoped, 53 s needs another
//     explanation, and this probe has refuted the full-rebuild hypothesis.
//   - one-edit incremental processes ~ALL files        => a single edit rebuilds the world, and the
//     53 s is explained. That is a defect on the commit path.
//   No threshold is being tuned here: the two outcomes are far apart, and either one is informative.
//
// CONTROL (same pass): the edit must actually REACH the graph. An incremental run that processes
// nothing is fast for the wrong reason, and would read as "scoped" while being broken.
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const SOURCE = process.env.APG_PROBE_SOURCE_REPO ?? process.cwd();
const workdir = mkdtempSync(join(tmpdir(), 'apg-inc-scope-'));
const clone = join(workdir, 'repo');
const say = (...a) => console.log(...a);

function fileNodeCount(dbPath) {
  // Counted from the graph itself, never from a directory walk — the denominator has to be the same
  // population the indexer is working over, or the fraction below compares two different nouns.
  const { openExistingDb } = requireDb;
  const db = openExistingDb(dbPath);
  try { return db.get("SELECT COUNT(*) AS c FROM nodes WHERE type = 'File'")?.c ?? 0; }
  finally { db.close?.(); }
}

let requireDb = null;

try {
  say(`cloning ${SOURCE} ...`);
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', SOURCE, clone], { stdio: 'pipe' });

  const target = join(clone, 'mcp/stdio/sync/watcher.js');
  if (!existsSync(target)) throw new Error(`probe target missing: ${target}`);
  const original = readFileSync(target, 'utf8');

  const { ensureFresh } = await import('../mcp/stdio/freshness/orchestrator.js');
  requireDb = await import('../mcp/stdio/storage/db.js');
  const dbPath = join(clone, '.aify-graph', 'graph.sqlite');

  say('full rebuild (the baseline the incremental runs are compared against) ...');
  const t0 = Date.now();
  await ensureFresh({ repoRoot: clone, force: true });
  const fullMs = Date.now() - t0;
  const totalFiles = fileNodeCount(dbPath);
  say(`  full rebuild: ${fullMs} ms over ${totalFiles} File nodes`);

  const rows = [];
  for (const [label, body] of [
    ['1 appended function', `${original}\nexport function probeOne() { return 1; }\n`],
    ['229 appended functions', original + Array.from({ length: 229 }, (_, i) => `\nexport function probeMany${i}() { return ${i}; }\n`).join('')],
  ]) {
    writeFileSync(target, body);
    const s = Date.now();
    const res = await ensureFresh({ repoRoot: clone, force: false });
    const ms = Date.now() - s;
    const processed = res?.processedFiles?.length ?? null;
    rows.push({ label, ms, processed });
    say(`  ${label.padEnd(24)} ${String(ms).padStart(7)} ms   processedFiles=${processed}`
      + `   ${processed === null ? '' : `(${((processed / totalFiles) * 100).toFixed(1)}% of ${totalFiles})`}`);
  }

  // CONTROL: the last edit really landed, so "few files processed" cannot mean "nothing happened".
  const { openExistingDb } = requireDb;
  const db = openExistingDb(dbPath);
  let landed = 0;
  try { landed = db.get("SELECT COUNT(*) AS c FROM nodes WHERE label LIKE 'probeMany%'")?.c ?? 0; }
  finally { db.close?.(); }

  say('');
  say('=== CONTROL ===');
  say(`edit reached the graph: ${landed} probeMany* nodes  ${landed > 0 ? 'PASS' : 'FAIL — an incremental run that indexes nothing is fast for the wrong reason'}`);
  say('');
  say('=== VERDICT (preregistered discriminator: processedFiles vs File nodes) ===');
  if (landed === 0) {
    say('⛔ CONTROL FAILED — conclude nothing.');
    process.exitCode = 2;
  } else {
    const worst = Math.max(...rows.map((r) => r.processed ?? 0));
    const frac = worst / totalFiles;
    say(frac > 0.5
      ? `⛔ A SINGLE-FILE EDIT REBUILDS THE WORLD: ${worst} of ${totalFiles} files (${(frac * 100).toFixed(1)}%). The 53 s is explained, and this cost lands on every commit.`
      : `✅ INCREMENTAL IS SCOPED: at most ${worst} of ${totalFiles} files (${(frac * 100).toFixed(1)}%). The full-rebuild hypothesis for the 53 s is REFUTED — it needs another explanation.`);
    process.exitCode = 0;
  }
} finally {
  // APG_PROBE_KEEP=1 leaves the clone so a second, PROFILED process can run one
  // incremental against it without the full rebuild dominating the profile.
  if (process.env.APG_PROBE_KEEP === '1') console.log(`KEPT: ${clone}`);
  else rmSync(workdir, { recursive: true, force: true });
}
