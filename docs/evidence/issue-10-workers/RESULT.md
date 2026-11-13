# Worker cap comparison

2026-11-13. Candidate b5edad59d08ff8da644e7ead32051e1affb3c118 throughout.
Node v22.20.0, Vitest 3.2.4, Windows, availableParallelism=32.

## Result

PASSES IN TESTS. The three requested bounded-worker gate runs all passed, below 10 minutes each.
The default-arm runs had no explicit worker limit. Vitest's source derives 31 forks on this host;
that is a configuration calculation, not an observed worker-process census.

| Arm | Limit | Vitest duration | Reported files | Passed cases | Skipped cases | VITEST_EXIT |
|---|---|---|---|---|---|---|
| Default 1 | unset | 173.52 s | 553 | 4415 | 4 | 1 |
| Default 2 | unset | 173.76 s | 553 | 4415 | 4 | 1 |
| Default 3 | unset | 158.08 s | 553 | 4415 | 4 | 1 |
| Bounded 1 | 8 forks | 215.24 s | 564 | 4460 | 4 | 0 |
| Bounded 2 | 8 forks | 198.00 s | 564 | 4460 | 4 | 0 |
| Bounded 3 | 8 forks | 191.49 s | 564 | 4460 | 4 | 0 |

Every default-arm run ended in `Error: [vitest-worker]: Timeout calling "onTaskUpdate"`.
Their missing count matches the 11-file LSP tier, but the failed JSON reports were deleted by the
old runner, so their exact omitted file identities are not established. The capped runs retain the
same four skips by name. Separate diagnostic full run at default concurrency also passed once;
this comparison does not prove every default run fails or identify the exact RPC bottleneck.

## Reproduction and preflight

On a clean checkout at the candidate, default arm: `node scripts/run-suite.mjs`.
Bounded arm, in Git Bash: `VITEST_MAX_FORKS=8 node scripts/run-suite.mjs`.
Vitest 3.2.4 maps that supported variable to `poolOptions.forks.maxForks`, which caps the active
forks pool at eight without editing the candidate. The LSP project remains single-fork.
Each completed log was byte-copied out before restoring only the runner-produced latest.log for
the next run; HEAD and every product file remained unchanged across all bounded arms.

Preflight before each bounded run:
- `docker ps --no-trunc --format '{{.ID}} {{.Names}} {{.Image}} {{.Status}}'`
- `Get-CimInstance Win32_Process`, checking the observer PID is present before querying Docker,
  buildx, buildctl and buildkit build processes.

| Arm | Preflight UTC | Observer control | Build processes | Containers |
|---|---|---|---|---|
| Bounded 1 | 2026-11-13T00:22:46.612Z | 1 | 0 | 6 ordinary services |
| Bounded 2 | 2026-11-13T00:26:30.785Z | 1 | 0 | 6 ordinary services |
| Bounded 3 | 2026-11-13T00:29:59.295Z | 1 | 0 | 6 ordinary services |

The six services were aify-comfyui-comfyui, aify-dashboard-aify-dashboard-1,
aify-comms-dashboard-next, aify-comms-service, aify-dashboard-caddy-1 and aify-comms-https.
No staging container was identified. These are launch-time checks, not whole-run resource isolation.
Default 3 had the same preflight at 00:10:25-27Z; Defaults 1 and 2 did not.

## Retained records

Default failures stay off main on docs/caller-closure-correction (5d0da6df, 496007da) and
docs/caller-closure-green (49b43acf), each under docs/evidence/suite/latest.log.
Per-run bounded logs, full preflight receipts and the executed diagnostic driver are retained under
.git/diagnostics/caller-closure-2026-11-13/ in this checkout as bounded-{1,2,3}.{json,log}
and run-bounded.mjs. This committed table and the commands above are the portable reproduction.
