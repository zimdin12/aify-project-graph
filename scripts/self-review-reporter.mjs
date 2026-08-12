// EVIDENCE REPORTER FOR scripts/self-review.mjs — because the BUILT-IN JSON REPORTER DROPS
// THE THING graph-senior-dev-hermes FORGED WITH.
//
// Measured, not assumed. Two runs of one file with one failing case, identical except that
// one also threw from `afterAll`:
//
//   teardown run : numTotalTestSuites=2 … numFailedTests=1 success=false
//   control run  : numTotalTestSuites=2 … numFailedTests=1 success=false
//
// Byte-identical in every scalar field, and the string "withheld teardown failure" appears
// NOWHERE in the report. So an unrelated teardown failure riding alongside a credited CAUGHT
// is invisible to `--reporter=json`, and no amount of reconciling its fields can see it.
// `numFailedTestSuites` is not a discriminator either — it reads 2 in BOTH runs (the control
// proved that before I used it, which is the only reason I did not ship it).
//
// ⇒ This reporter emits what the classifier actually needs: per-case identity/status/messages
// AND the non-case error population — unhandled errors plus per-file `result.errors`, which
// is where hook failures live.
import { writeFileSync } from 'node:fs';

export default class SelfReviewReporter {
  onInit(ctx) { this.ctx = ctx; }

  onFinished(files = [], errors = []) {
    const cases = [];
    const fileErrors = [];
    const walk = (task, ancestors) => {
      if (task.type === 'test' || task.type === 'custom') {
        cases.push({
          fullName: [...ancestors, task.name].join(' '),
          name: task.name,
          status: task.result?.state ?? 'skipped',
          messages: (task.result?.errors || []).map((e) => e?.message ?? String(e)),
          // ⛔ PHASE IS NOT AVAILABLE. Measured on Vitest 3.2.4: a task's `result` carries
          // {state,startTime,retryCount,repeatCount,errors,duration} and NOTHING naming the
          // lifecycle phase, so a `beforeEach` throw is stored in the same slot as a body
          // assertion. The only incidental difference is the ERROR TYPE — a hook `throw new
          // Error(...)` yields `Error`, a body `expect` yields `AssertionError` — and that is
          // author-controlled, so it is a contamination signal, NOT route authority.
          errorTypes: (task.result?.errors || []).map((e) => e?.name ?? 'Unknown'),
          // Exposed by Vitest and used to refuse attempt-multiplied evidence.
          retryCount: task.result?.retryCount ?? 0,
          repeatCount: task.result?.repeatCount ?? 0,
        });
        return;
      }
      // ⚠ SUITE-LEVEL ERRORS ARE COLLECTED HERE, and finding that took two failed attempts.
      // An `afterAll` throw is attached to the SUITE task that owns the hook — not to the
      // file's `result.errors`, and not to the `errors` argument. My first reporter walked
      // only tests and files and reported nonCaseErrors=0 for the exact case dev forged with.
      for (const e of task.result?.errors || []) {
        if (task !== task.file) fileErrors.push({ file: task.file?.name ?? null, scope: 'suite', suite: task.name, message: e?.message ?? String(e) });
      }
      for (const c of task.tasks || []) walk(c, task.name ? [...ancestors, task.name] : ancestors);
    };

    for (const f of files) {
      for (const e of f.result?.errors || []) {
        fileErrors.push({ file: f.name, scope: 'file', message: e?.message ?? String(e) });
      }
      walk(f, []);
    }
    for (const e of errors || []) {
      fileErrors.push({ file: null, scope: 'unhandled', message: e?.message ?? String(e) });
    }

    const out = process.env.SELF_REVIEW_OUT;
    if (!out) return;
    writeFileSync(out, JSON.stringify({
      schema: 'self-review-evidence/3',
      // ⛔ OWNERSHIP NONCE. graph-senior-dev-hermes executed a command-route forgery: because
      // `tests[]` flowed through `shell:true`, a crafted selector injected a SECOND process
      // that wrote schema-valid evidence to SELF_REVIEW_OUT while the reporter's own bytes
      // stayed correctly pinned. The gauge was intact and the EVIDENCE FILE was substituted.
      // A per-invocation nonce the runner generates and verifies means a foreign writer must
      // guess it. This is custody of the artifact, which pinning the producer never provided.
      nonce: process.env.SELF_REVIEW_NONCE ?? null,
      cases,
      fileErrors,
      counts: {
        cases: cases.length,
        failedCases: cases.filter((c) => c.status === 'fail').length,
        nonCaseErrors: fileErrors.length,
      },
    }, null, 2));
  }
}
