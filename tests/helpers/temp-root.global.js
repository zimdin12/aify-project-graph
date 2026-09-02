// ⛔ ONE TEMP ROOT PER RUN, REMOVED WHOLESALE. This exists because per-test cleanup FAILED AT SCALE.
//
// Measured 2026-09-02 on this machine: 379,380 leaked temp directories in %TEMP% — 328,427 of them
// ours (`apg-*`, `system-inclu*`) — ~26 GB, accumulating since 2026-05-31, at roughly 2,000–4,000
// per full suite run. They came from many different test files, each calling `mkdtempSync` and each
// relying on its own `afterAll` to clean up. Dozens of authoring sites, no gate, so the ones that
// forgot were invisible.
//
// ⚠ AND THE COST WAS NOT THE BYTES. 379k directories made every enumeration of %TEMP% crawl for
// minutes, which is why the disk investigation itself was so slow. Then the volume hit 100% and the
// suite died with ENOSPC — `head` could not write to a pipe.
//
// ⇒ THE FIX IS MECHANICAL, NOT A DISCIPLINE. `vitest.config.js` points TEMP/TMP/TMPDIR at a fresh
// per-run directory, so every `mkdtempSync(join(os.tmpdir(), …))` in every test — and anything a
// spawned child writes to its temp dir, clangd included — lands inside ONE directory that this
// teardown deletes in a single operation. A test that forgets to clean up is now harmless.
import { rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT_PREFIX = 'apg-vitest-';

// ⚠ SELF-HEALING, because a crashed or killed run never reaches teardown. Without this, the very
// failure mode that motivated the fix — an aborted suite — would quietly rebuild the pile.
// One hour is comfortably longer than the full suite (~13 min) and short enough to bound growth.
function pruneAbandonedRoots(keepPath) {
  const parent = tmpdir();
  let entries = [];
  try { entries = readdirSync(parent); } catch { return 0; }
  const cutoff = Date.now() - 60 * 60 * 1000;
  let pruned = 0;
  for (const name of entries) {
    if (!name.startsWith(ROOT_PREFIX)) continue;
    const path = join(parent, name);
    if (path === keepPath) continue;
    try {
      if (statSync(path).mtimeMs > cutoff) continue; // another run may be live in it
      rmSync(path, { recursive: true, force: true });
      pruned += 1;
    } catch { /* in use, or vanished under us — either way not ours to force */ }
  }
  return pruned;
}

export default function setup() {
  // The root itself is created in vitest.config.js, because the value must reach the worker `env`
  // at config-evaluation time. This hook owns only its REMOVAL.
  const root = process.env.APG_TEST_TMP_ROOT;

  return () => {
    const pruned = pruneAbandonedRoots(root);
    if (pruned > 0) process.stderr.write(`[temp-root] pruned ${pruned} abandoned run root(s)\n`);
    if (!root) return;
    try {
      rmSync(root, { recursive: true, force: true });
    } catch (error) {
      // Never fail the run over cleanup — a locked handle from a child that outlived the suite is
      // possible, and the next run's prune will collect it. Stated, not silent.
      process.stderr.write(`[temp-root] could not remove ${root}: ${error.message}\n`);
    }
  };
}
