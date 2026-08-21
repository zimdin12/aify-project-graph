# D1 hermetic fixture — design, before implementation

**Status: DESIGN ONLY.** No implementation, no mutant run. Sent for referee ruling per
`1787273117949-6a2c5769`.

## Why the current fixture cannot carry D1

The D1 run (`27a1b0c`, immutable) produced `INVALID_EXPECTATION_MISMATCH` for two reasons, and only
one of them was my prediction being wrong.

1. **No discriminating power.** I preregistered `b.url === a.url` as the witness. The mock returns
   the *same* url for every start, so two rival dashboards are indistinguishable by url. The
   assertion could not tell the honest world from the hostile one, and passed in both.
2. **A second message by construction.** The mutation creates a rival dashboard that holds
   `graph.sqlite` open; fixture teardown then fails with `EBUSY`. Two messages land on one case, and
   the one-accountable-message rule refuses it.

⛔ The referee's ruling on (2) is the part that shapes this design: **do not weaken accountability**
to admit "assertion plus teardown fallout" — that would let any noisy arm relabel its noise as
consequence. And **do not classify the leak as apparatus noise** — it is mutation-induced evidence,
and suppressing it would erase the strongest signal the mutation produces.

⇒ So the fixture must make the leak **observable and attributable**, then clean it up *after* the
evidence is recorded — without the cleanup making production look as though it released the rival.

## The four things the fixture must separate

| # | Question | Owner of the answer |
|---|---|---|
| 1 | How many servers/DBs were **opened**? | the harness inventory |
| 2 | Which of them did **production** register as owned? | the registry under test |
| 3 | Which were left **unowned** when the verb returned? | inventory minus registry |
| 4 | Did the fixture directory then remove cleanly? | post-cleanup filesystem check |

The current fixture answers only (2) and conflates (4) with it. A test that can only see the final
registry entry cannot distinguish *"production released it"* from *"it was never opened."*

## Design

### A. Per-invocation identity, with a baseline control

Every stubbed start receives a unique token — a monotonic counter plus the requested `repoRoot` —
and returns `url: http://127.0.0.1:<port>/#<token>`. The handle carries the token too.

⛔ **A baseline control proves the tokens actually differ**, in the honest world, before any hostile
use: two deliberate distinct invocations must yield two distinct tokens. Without that control the
new discriminator repeats the old defect one layer up — an identity that does not vary is exactly
what made `b.url === a.url` useless.

### B. A handle inventory, not a counter

The `openExistingDb` proxy and the server stub each register into one inventory:

```
{ id, kind: 'db' | 'server', token, openedAt, closedBy: null | 'production' | 'harness' }
```

`closedBy` is set by whoever calls `close()`. ⚠ **`'production'` is recorded only when the call
arrives through the verb's own release path**, never by the harness marking its own work as
production's. That distinction is the whole point: a harness that closes a handle and records it as
released would manufacture the appearance of correct ownership.

### C. Evidence capture strictly before cleanup

Order is load-bearing:

1. run the scenario;
2. **snapshot** the inventory and the registry — this is the evidence;
3. run the case's assertions against the snapshot;
4. only then, harness-close every still-open handle, marking `closedBy: 'harness'`;
5. remove the fixture directory and assert it succeeded.

⇒ Cleanup errors cannot ride along on the assertion, because cleanup happens after the assertions
have already been evaluated against a frozen snapshot. That satisfies the one-accountable-message
rule without weakening it.

### D. Controls the fixture must carry

- **Honest one-start path**: exactly one server and one DB opened; both `closedBy: 'production'`;
  registry owned 1; fixture removes cleanly with no `EBUSY`.
- **Controlled two-start path** (constructed, not mutation-induced): two distinct tokens observed —
  proving rival starts *are* distinguishable.
- **Leak visibility**: under a hostile world where production owns fewer handles than were opened,
  the snapshot shows `opened > owned` with the specific unowned ids.
- **Harness cleanup is not ownership**: a handle closed in step 4 must report `closedBy: 'harness'`,
  and an assertion must prove that value is never `'production'` for a handle production never
  released.
- **`EBUSY` disappears only after the unowned handle is closed** — recorded, because it is the
  evidence that the lock *was* the leak rather than ambient noise.

## What this design does NOT do

- It does **not** author a D1 predicate. Both the executor and the current referee have seen the old
  answer; a third blind referee must derive one from the guarantee and the new fixture source.
- It does **not** re-run D1 under the old preregistration. `27a1b0c` stands; any future attempt is a
  **new carrier** with a new preregistration citing the failed one.
- It does **not** establish that the generation check is the reason `:231` survived. That remains
  uncontrolled source reasoning. The bounded statement is: *on the exact D1 mutant carrier, two
  starts were observed and `EBUSY` appeared only in the mutant artifact; the rival unowned
  dashboard/DB is the supported explanation for the teardown lock.*

## Open question for the referee

Whether the inventory should live in the test file or in a shared dashboard-fixture helper. A shared
helper would serve D2–D8 too, but it becomes an instrument that itself needs witnesses — and this
repo has already learned that a test helper is production code for the tests that trust it.
