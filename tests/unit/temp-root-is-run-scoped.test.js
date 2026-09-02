// ★ EVERY TEST'S TEMP DIRECTORY LANDS INSIDE THE PER-RUN ROOT, so one deletion collects all of it.
//
// ⛔ WHY THIS IS ASSERTED BEHAVIOURALLY AND NOT BY READING THE CONFIG. A config file can declare
// `TEMP: RUN_TMP` and still not reach the workers — vitest's `env` and the pool's process model
// decide that, not the declaration. Twice today a gate of mine passed on a token being PRESENT in a
// file while the value never reached the code. So this calls `os.tmpdir()` from inside a real test
// worker and looks at what actually comes back.
//
// The defect it guards: 379,380 leaked temp directories in %TEMP% (328,427 ours), ~26 GB,
// accumulated since 2026-05-31 at ~2,000–4,000 per suite run, until the volume hit 100% and the
// suite died with ENOSPC. Dozens of files each owned their own `afterAll`; the ones that forgot were
// invisible because nothing checked.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const norm = (p) => resolve(p).replaceAll('\\', '/').toLowerCase();

describe('the suite writes temp files into a run-scoped root', () => {
  it('POSITIVE CONTROL: the run root is declared and exists', () => {
    // Without this, every assertion below could pass in a world where nothing was configured at
    // all — `undefined` compared against `undefined`.
    const root = process.env.APG_TEST_TMP_ROOT;
    expect(root, 'APG_TEST_TMP_ROOT must reach the worker').toBeTruthy();
    expect(existsSync(root), 'the run root must exist on disk').toBe(true);
  });

  it('★ os.tmpdir() inside a worker resolves to the run root', () => {
    // This is the assertion that makes the whole mechanism work: every test in the suite builds its
    // temp path from os.tmpdir(), so if this is redirected, they all are — with no per-file change.
    expect(norm(tmpdir())).toBe(norm(process.env.APG_TEST_TMP_ROOT));
  });

  it('★ a directory made the way tests make them lands INSIDE the run root', () => {
    // The exact idiom used across the suite: mkdtempSync(join(os.tmpdir(), 'apg-…')).
    const dir = mkdtempSync(join(tmpdir(), 'apg-temproot-probe-'));
    try {
      expect(norm(dir).startsWith(norm(process.env.APG_TEST_TMP_ROOT) + '/'),
        `a leaked fixture dir must sit under the run root so one rmSync collects it — got ${dir}`)
        .toBe(true);
    } finally {
      // Cleaned here too, but the POINT is that forgetting this line is now harmless.
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('⛔ the run root is NOT the system temp dir — otherwise deleting it would be catastrophic', () => {
    // The teardown removes this path recursively. If it ever resolved to the real %TEMP%, cleanup
    // would delete every other process's temp state on the machine. Fail closed on that.
    const root = norm(process.env.APG_TEST_TMP_ROOT);
    expect(root, 'the run root must be a SUBDIRECTORY, never the temp dir itself')
      .not.toBe(norm(process.env.APG_SYSTEM_TMP ?? 'C:/Users/nonexistent-sentinel'));
    expect(root.split('/').pop().startsWith('apg-vitest-'),
      'the run root must carry the prefix the pruner looks for, or abandoned roots are never collected')
      .toBe(true);
  });
});

// ⛔ THE TEARDOWN IS TESTED DIRECTLY, because the tests above prove only that files LAND in the
// root — not that anything ever removes it. Removing `globalSetup` from the config would leave
// every assertion above green while the leak continued exactly as before: the half that fixes the
// defect would be gone, and the half that proves the plumbing would still pass.
describe('the run-root teardown actually deletes', () => {
  it('★ the returned teardown removes the root it is given', async () => {
    const { mkdtempSync: mk } = await import('node:fs');
    const globalSetup = (await import('../helpers/temp-root.global.js')).default;

    const scratch = mk(join(tmpdir(), 'apg-teardown-probe-'));
    mk(join(scratch, 'nested-')); // non-empty: a recursive delete is what is required
    expect(existsSync(scratch), 'positive control: the probe dir exists before teardown').toBe(true);

    const previous = process.env.APG_TEST_TMP_ROOT;
    process.env.APG_TEST_TMP_ROOT = scratch;
    try {
      const teardown = globalSetup();
      expect(typeof teardown, 'setup must return a teardown, or nothing is ever cleaned').toBe('function');
      await teardown();
      expect(existsSync(scratch), 'the teardown must remove the root, recursively').toBe(false);
    } finally {
      process.env.APG_TEST_TMP_ROOT = previous;
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('a missing root is survivable — cleanup never fails the run', async () => {
    // A crashed run can leave APG_TEST_TMP_ROOT unset or pointing at something already gone.
    // Cleanup throwing there would turn a green suite red for no product reason.
    const globalSetup = (await import('../helpers/temp-root.global.js')).default;
    const previous = process.env.APG_TEST_TMP_ROOT;
    delete process.env.APG_TEST_TMP_ROOT;
    try {
      await expect(Promise.resolve(globalSetup()())).resolves.not.toThrow();
    } finally {
      process.env.APG_TEST_TMP_ROOT = previous;
    }
  });
});
