# D1 hermetic fixture — design v2, before implementation

**Status: DESIGN ONLY.** No implementation, no mutant run. Revised per `1787276330176-ff568507`.

## Why the current fixture cannot carry D1

The D1 run (`27a1b0c`, immutable) produced `INVALID_EXPECTATION_MISMATCH` for two reasons, and only
one was my prediction being wrong.

1. **No discriminating power.** I preregistered `b.url === a.url`. The mock returns the *same* url
   for every start, so two rival dashboards are indistinguishable by url. The assertion passed in
   both worlds.
2. **A second message by construction.** The mutation leaves a rival dashboard holding
   `graph.sqlite`; teardown then fails with `EBUSY`. Two messages on one case, and the
   one-accountable-message rule refuses it.

⛔ Neither is fixed by weakening accountability — that would let any noisy arm relabel its noise as
consequence. Nor by suppressing the leak, which is **mutation-induced evidence**, the strongest
signal the mutation produces.

⇒ The fixture must make the leak **observable and attributable**, then clean it up *after* the
evidence is frozen, without the cleanup making production look as though it released the rival.

## Scope: test-file-local

Implemented inside `repo-root-wiring.test.js`. **Not** a shared D2–D8 helper: there is one
demonstrated consumer, and a helper built before a second real route needs it becomes an instrument
that itself requires hostile witnesses. If a second arm later needs the same carrier, extract
mechanically with behaviour parity and helper tests then.

## A. Ownership is a CAPABILITY, not an inference

⛔ **The wrapper cannot honestly know that an arbitrary `.close()` came from production** merely
because harness cleanup is not currently running. A mutable phase flag or stack inspection would be
the fixture *guessing* at attribution — and a fixture that guesses ownership manufactures exactly
the appearance this arm is meant to measure.

⇒ Production and the harness get **different capabilities**:

| holder | what it receives | recorded on close |
|---|---|---|
| production | the wrapped handle returned by the mocked opener | `closedBy: 'production'` |
| harness | an out-of-band raw closure, **never reachable through the wrapper** | `closedBy: 'harness'` |

- The raw closure is retained in the fixture's own inventory and is not a property of the object
  production holds, so production has no path to it.
- **Double close fails loudly**, and so does conflicting attribution — a handle already
  `closedBy: 'production'` being closed again, or by the harness, is an apparatus error, not a
  silently overwritten field.

## B. Snapshot → release → snapshot → clean → assert

The v1 order (`snapshot → assertions → cleanup`) recreates the two-message problem: an assertion
throwing before or alongside cleanup puts two errors on one case again.

```
1  run the scenario
2  SNAPSHOT   opened handles · returned values · registry contents        ← immutable
3  invoke the ORDINARY production release path
4  SNAPSHOT   production-closed vs still-open                             ← immutable
5  harness-close residual handles through the raw capabilities
6  remove the fixture directory, record the result as a typed field
7  ONLY NOW assert against the frozen snapshots
```

⇒ Harness cleanup at step 5 **cannot rewrite the `closedBy` values frozen at step 4**. A cleanup
failure at step 6 becomes a typed apparatus precondition carried into the assertions, not a second
error attached after the witness assertion.

## C. Per-invocation identity, and its own control

Each stubbed start receives a token from a factory. ⛔ **The factory is exercised independently, and
two invocations are proven to differ, BEFORE any test uses token equality as a discriminator.**
Without that control the new identity repeats the old defect one layer up — an identity that does
not vary is precisely what made `b.url === a.url` useless.

⚠ **DB and server handles get separate ids and are NOT correlated by concurrent call order.** Order
is not identity; a typed invocation carrier must bind them explicitly, or they stay separate facts.

## D. Portable authority — handle accounting, not `EBUSY`

⛔ `EBUSY` is **carrier-bound corroboration, not the predicate.** Linux will happily unlink an open
file, so a fixture asserting `EBUSY` would be asserting Windows.

⇒ The portable authority is the accounting: **opened / production-closed / harness-closed /
still-open**. Filesystem removal is a final cleanup check whose result is recorded, not the witness.

## E. Controls the fixture must carry

- **Honest one-start path**: one server, one DB, both `closedBy: 'production'`, registry owns 1,
  fixture removes cleanly.
- **Token factory**: two invocations yield two distinct tokens — proven before any equality is used.
- **Controlled two-start path** (constructed, not mutation-induced): two distinct tokens observed.
- **Leak visibility**: where production owns fewer handles than were opened, the frozen snapshot
  names the specific unowned ids.
- **Harness cleanup is not ownership**: a handle closed at step 5 reports `closedBy: 'harness'`, and
  an assertion proves that value is never `'production'` for a handle production never released.
- **Double close / conflicting attribution** raises loudly rather than overwriting.

## What this design does NOT do

- It does **not** author a D1 predicate. The executor and the current referee have both seen the old
  answer; a **third blind referee** must derive one from the guarantee and the new fixture source.
- It does **not** re-run D1 under the old preregistration. `27a1b0c` stands; any future attempt is a
  new carrier with a new preregistration citing the failed one, never presented as redemption.
- It does **not** establish why `:231` survived. The bounded statement remains: *on the exact D1
  mutant carrier, two starts were observed and `EBUSY` appeared only in the mutant artifact; the
  rival unowned dashboard/DB is the supported explanation for the teardown lock.*
