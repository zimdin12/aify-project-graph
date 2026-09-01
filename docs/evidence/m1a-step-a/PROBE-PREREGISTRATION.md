# Differential probe — did step A cause the scoped-collect zero?

Written **before** the probe ran. Review's ruling, accepted: my earlier control proved only that
step A is not a *deterministic always-fail* regression. It did **not** prove "not step A" — a
load-sensitive interaction introduced or amplified by step A fits every observation I had, and
editing one test file can change full-suite scheduling without ever touching clangd.

## The observation being explained

`tests/integration/code-intel/scoped-collect-survives-real.test.js`, two assertions, both
`expected 0 to be greater than 0`:

- `a budget-limited scope=all run CONTINUES on re-run` — `ledger.collected` was empty
- `a resumed call scopes its authority to the files it walked` — `verifiedEdgeCount` was 0

Receipts, preserved in `receipts/` rather than left in temp:

| run | result | file |
|---|---|---|
| full suite, step-A subject | **RED**, `VITEST_EXIT=1` | `SUITE-RED-scoped-collect-2026-09-01.txt` |
| same file, isolated | PASS 6/6, 22.3 s | `SUITE-ISOLATED-PASS-scoped-collect.txt` |
| full suite, same subject, rerun | GREEN, `VITEST_EXIT=0` | `SUITE-GREEN-rerun-2026-09-01.txt` |

⚠ The green rerun does **not** close this. It shows the subject *can* pass; it establishes neither
a rate nor causal innocence, and it does not erase the red.

## Why a bare zero is not evidence

`expected 0 to be greater than 0` is emitted identically by a starved clangd and by a broken graph
join. **The test and the product share one ambiguous failure string**, so no number of reruns can
discriminate. The probe therefore records a *cause*, not a pass/fail.

A specific mechanism is available and the test names it itself: the run uses `budgetMs: 9000`, with
the comment *"not so small the index wait eats it entirely"*, and `splitCollectBudget` divides that
further to reserve a share for the import. Under parallel load, clangd startup plus index wait can
consume the whole collect budget. Consistent with the observed failure, where the `status`
assertion **passed** (`ok`/`partial`) and only the collected count failed.

⚠ That is a hypothesis. It does not clear step A, which could plausibly slow the pre-collect path
(extra per-symbol work in `siteKindOf`/`siteSpanOf`, and a shape/ordinal pass in
`fileStructuralFingerprint`).

## Subjects

| subject | commit | verified |
|---|---|---|
| pre-step-A | `8a3675f` | `code-symbol-site-id.js` **absent** |
| step-A | `29fc344` | present |

Both run from git worktrees on the same machine, same `node_modules`, same clangd — one toolchain
carrier, so a toolchain difference cannot masquerade as a subject difference.

## Protocol

Alternating A/B, never all of one then all of the other, so drift in machine state cannot align
with the subject. N repetitions per subject, under matched background load applied identically to
both arms.

## Captured per run

- run status and `budgetExhausted`
- `ledger.collected.length` — **the quantity that failed**
- the walked-file denominator: how many files the collection considered at all
- wall-clock elapsed, and time to the first collected file
- clangd exit/signal/timeout where observable

A run recording zero collected files **with no captured cause** is reported as
`zero_cause_unknown`, not as evidence for either side.

## Controls

- **positive** — at least one run in each arm must collect > 0 files. If an arm never collects
  anything, that arm's environment is broken and its zeros carry no information.
- **negative** — a deliberately impossible budget (`budgetMs` far too small) must produce zero in
  both arms, proving the probe can observe the failure it is looking for.
- **carrier** — both worktrees resolved from one repo, one `node_modules`, one clangd binary.

## Preregistered outcomes

- **(a)** rates and causes equivalent across subjects → step A is innocent of this, and the
  budget brittleness is recorded as **its own finding**, not absorbed into step A's record.
- **(b)** step A changes the failure rate or its cause → step A owns it and must fix it.
- **(c)** neither arm reproduces the zero under this load → the probe failed to recreate the
  conditions, and that is reported as such. It is **not** read as (a).

## Claim ceiling

"Under this load, on this machine, these two subjects produced these rates and these causes."
No claim about the failure rate in CI, on other hardware, or under other schedulers.
