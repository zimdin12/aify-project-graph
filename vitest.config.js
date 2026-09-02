import { defineConfig } from 'vitest/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ⛔ EVERY TEST'S TEMP DIRECTORY LIVES INSIDE ONE PER-RUN ROOT THAT IS DELETED WHOLESALE.
//
// Measured 2026-09-02: 379,380 leaked directories in %TEMP%, 328,427 of them ours, ~26 GB,
// accumulating since 2026-05-31 at roughly 2,000–4,000 per full suite run. Dozens of test files
// call `mkdtempSync` and each relied on its own `afterAll`; the ones that forgot were invisible
// because nothing checked. The volume eventually hit 100% and the suite died with ENOSPC.
//
// Node's `os.tmpdir()` reads TEMP/TMP (Windows) or TMPDIR (POSIX) at CALL time, so redirecting them
// here relocates every `mkdtempSync(join(os.tmpdir(), …))` in every worker — and anything a spawned
// child writes to its own temp dir, clangd included — without touching a single test file.
//
// ⇒ Computed at config-evaluation time because the value has to reach BOTH the worker `env` below
// and the globalSetup teardown, which runs in this process.
const RUN_TMP = join(tmpdir(), `apg-vitest-${process.pid}-${Date.now()}`);
mkdirSync(RUN_TMP, { recursive: true });
process.env.APG_TEST_TMP_ROOT = RUN_TMP;

export default defineConfig({
  test: {
    // Deletes RUN_TMP after the run, and prunes roots abandoned by a crashed one.
    globalSetup: ['./tests/helpers/temp-root.global.js'],
    include: ['tests/**/*.test.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // REAL-SERVER TESTS MUST NOT RACE EACH OTHER.
    //
    // tests/integration/code-intel/* each spawn a real language server (clangd,
    // tsserver, pyright). Run concurrently they compete for CPU, and a cross-TU
    // reference query can be issued before the server has finished parsing its
    // warmup files — so a legitimately-absent caller fails the assertion. It
    // reproduced twice under full-suite load and passed every time in isolation.
    //
    // Two earlier fixes were the wrong shape: waiting on INDEX readiness (the index
    // being ready is not the same as this file being parsed), then waiting on the
    // per-file parse signal. The second was right on its own terms and made the
    // product more honest — batchWarmup no longer sleeps a fixed duration — but no
    // wait can conjure CPU that four concurrent language servers are already using.
    //
    // The remaining cause is contention, so the fix is scheduling, not another
    // timeout. A flaky test is worse than a slow one: it teaches the reader to
    // re-run rather than to look, which is exactly how a real regression gets waved
    // through.
    fileParallelism: false,
    // ⚠ PINNED, NOT INHERITED. `tests/unit/freshness/relative-reporoot.test.js` calls
    // process.chdir() to prove a RELATIVE repoRoot resolves the same as an absolute one —
    // and process.chdir() throws inside vitest's `threads` pool ("not supported in
    // workers"). It passes here only because the CURRENT default happens to be `forks`.
    //
    // ★ review, hermes session hit exactly that restriction running an isolated archive,
    // and reported it among failures they could not attribute. The suite was relying on a
    // DEFAULT to satisfy a hard requirement — and a default is not a decision, it is
    // whatever the tool picked this version. It has already moved once (vitest 2 changed
    // from threads to forks), so this would have broken on an upgrade with a failure that
    // looks like a test bug rather than a config assumption.
    //
    // ⇒ Stated explicitly so the requirement travels with the repo rather than with my
    // installed version.
    pool: 'forks',
    // ★★ THE WHOLE SUITE RUNS SEALED. In production a packet route that emits a candidate
    // list without consulting the shared disclosure renderer gets a loud caveat appended —
    // degrading a user's answer is better than crashing their call. Under test it THROWS,
    // so any test that so much as touches such a route fails hard instead of quietly
    // recording the caveat as expected output.
    //
    // ⇒ This is what makes the guarantee route-sensitive rather than function-sensitive.
    // review, hermes session killed the source inventory by adding a disclosure-less branch
    // INSIDE graphPacket — which the inventory passed, because that 396-line function calls
    // the renderer elsewhere. Nothing pattern-matched over source can attribute a header to
    // the path that produced it. Executing it can.
    // ⛔ AND THE SUITE'S VERDICT MUST NOT DEPEND ON MACHINE LOAD.
    //
    // graph_packet bounds a symbol→feature lookup at 2000ms in production. That lookup's own
    // measured cost is 601ms on a 3958-node repo and 4316ms on a 12126-node one, so on a busy
    // machine it crosses the line, packet takes its TIMEOUT branch, and every test asserting on
    // CONTENT fails. Measured on one unchanged tree in a single session: 680s / 2120s / 2693s with
    // 0 / 2 / 10 failures — failures scaling with duration, all budget-shaped.
    //
    // That destroys the signal the "full suite green before push" gate exists to give: a real
    // regression becomes indistinguishable from contention, and three separate investigations in
    // that session ended in "it was load".
    //
    // ⛔ AND THE VALUE IS BOUNDED ON BOTH SIDES — "loses no coverage" was WRONG at 30000ms.
    //
    // Two classes of test pull in opposite directions:
    //   CONTENT tests need the lookup to COMPLETE, so the budget must exceed a real lookup.
    //   TIMEOUT tests (packet-timeout-not-absence) MOCK A HANG FOREVER to prove a timeout is not
    //     reported as an absence, so they fire at exactly the budget — and at 30000ms that blew
    //     their own 20s test limit, turning four real assertions into test timeouts. Those tests DO
    //     assert on latency behaviour, which is the coverage I claimed did not exist.
    //
    // 8000ms satisfies both: above any realistic fixture lookup (measured 601ms on a 3958-node
    // repo, and these fixtures are far smaller) even under the 4x load seen today, and below the
    // 20000ms test timeout so a mocked hang still fires inside it.
    //
    // The PRODUCT default is untouched at 2000ms — `live-budget-is-configurable.test.js` pins it in
    // a child process, because the constant resolves at module load and an in-process assertion
    // cannot tell a read environment from an ignored one.
    // TEMP/TMP/TMPDIR are all three set because os.tmpdir() consults a different one per platform,
    // and the suite must behave identically on Windows and POSIX.
    env: {
      APG_PACKET_SEAL_STRICT: '1',
      APG_LIVE_BUDGET_MS: '8000',
      TEMP: RUN_TMP,
      TMP: RUN_TMP,
      TMPDIR: RUN_TMP,
      APG_TEST_TMP_ROOT: RUN_TMP,
    },
  },
});
