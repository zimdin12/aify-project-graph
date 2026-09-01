# Typed zero-reason for the collect path — preregistration

Written **before** implementation. Review's direction after M1a step A closed: make the test and
the product return a typed reason and a denominator, so a **naturally occurring** zero is
attributable when it happens — rather than manufacturing one now by raising n until it appears.

## The defect

`graphCollectCodeIntel` can return `status: 'partial'` having collected nothing, and no single
field says why. The integration test then asserts `expected 0 to be greater than 0`. **The test and
the product share one ambiguous failure string**: a starved clangd and a broken graph join surface
identically, so the assertion cannot say which occurred, and no number of reruns separates them.

This is M2's contract in the collect path — "no callers" versus "no callers in indexed scope" —
where an agent meets it first.

## What already exists, and does not need building

The `index` block already carries the raw material with absent-vs-zero discipline: `indexReady`,
`budgetExhausted`, `filesProcessed`, `filesTotal`, `resumedFrom`, `enumeratedTotal`,
`resumeLedger`, plus `positionGuessSkipped`, `refsTruncatedSymbols`, `outOfRepoSkipped`.
**The denominator is already there.** What is missing is one typed value a consumer can route on.

## The discriminator, from my own broken probe

Every **successful** run in the repaired differential reported `budgetExhausted: true` and still
collected a file. **Budget exhaustion is the normal end state, not the failure.** A reason keyed on
it alone would fire on healthy runs — which is precisely what made v1's `partial_no_files`
meaningless. The reason must be conditioned on `filesProcessed === 0`: exhausted *before* the first
file, not after the last.

## The contract  `[AMENDED ON REVIEW — my first enum is REJECTED, see below]`

**Field:** `index.zeroFilesProcessedReason`, inside `index` beside `filesProcessed`/`filesTotal`,
carrying its own schema discriminator. Emitted **only** when `filesProcessed` is the **integer** 0.

⚠ **Named for its population.** A bare `zeroReason` invites a reader to apply it to zero records,
zero edges or zero callers, none of which it explains.

⚠ **Placement is `index`, not top-level, and my argument for top-level was wrong.** I proposed
top-level to avoid the true-value-nobody-reads failure. But **visibility is not consumption** — a
top-level field can have zero consumers just as easily, while a copy beside the session-derived
denominator creates two owners. The remedy is the end-to-end consumer test below, not nesting.

### Values — derived ONLY from explicit producer assertions

| value | authority |
|---|---|
| `ALREADY_COMPLETE` | producer's typed `already_collected` note, emitted **after** its graph-witness ledger read |
| `NO_FILES_IN_REQUESTED_SCOPE` | producer's typed `no_files` note |
| `BUDGET_EXHAUSTED_BEFORE_FIRST_FILE` | producer's typed budget-exhaustion note **and** integer `filesProcessed === 0` |
| `ZERO_FILES_CAUSE_UNKNOWN` | none of the above — explicit, never inferred |
| `UNKNOWN_CONFLICT` | two contradictory typed producer reasons |

`status: 'error'` / `errors[]` stays the **existing separate route**. There is no `PROVIDER_ERROR`
zero value: the wrapper returns early on error and emits no `index` block at all.

⛔ **Three of my values are struck, all for the same reason — scalar inference:**

- `NO_ELIGIBLE_FILES` from `filesTotal === 0`. `filesTotal` is **this call's remainder**; it is also
  0 on a converged resume, and a capped walk can exhaust its visible list. Replaced by the
  producer's `no_files` note.
- `ALREADY_COMPLETE` from `resumeLedger` / `resumedFrom`. A resume count is not a completion
  assertion.
- `INDEX_NOT_READY` from `indexReady === false`. That is a **state**, not a demonstrated cause of
  zero files. It returns only if a producer explicitly reports it prevented processing file 1.

⚠ **Missing or non-integer `filesProcessed` OMITS the field entirely.** ⛔ Amended on review — my
first rule said "UNKNOWN, never coerced to zero", and that was still wrong: `ZERO_FILES_CAUSE_UNKNOWN`
**asserts that zero files were processed** and only leaves the cause open. If the wrapper cannot
establish the population, it cannot assert the population, so it must say nothing here. Any
unknown-population signal belongs on a separate contract/telemetry channel.

⇒ `ZERO_FILES_CAUSE_UNKNOWN` is reachable **only** when `filesProcessed` is the integer 0 **and**
no authoritative typed reason applies.
⚠ Conflicting reasons emit `UNKNOWN_CONFLICT`, **never a precedence-selected winner**. Picking one
would mean choosing which explanation to believe, which is the flattering-noun failure in a new form.

### The authority boundary, and the producer change it requires

The summary layer must **not** reconstruct graph-witness validity. The provider owns
`readLedger(..., graphWitness)`; after that verified read it must emit an explicit typed
`already_collected` note on its zero-file return, and the summary maps **that assertion** to
`ALREADY_COMPLETE`.

`lsp-collect.js:280-286` already behaves this way. **`cpp-clangd` does not**: it has the checked
ledger read at `:241-248` but emits only three note codes — `compile_db_all_filtered`, `no_files`,
`budget_exhausted` — and **no `already_collected`**. Measured, not assumed.

⇒ So `ALREADY_COMPLETE` is currently unreachable for the C++ provider.

⛔ **AND THAT GAP IS CLOSED IN THIS UNIT, NOT DEFERRED.** Amended on review, and the reasoning is
one I should have reached myself: **the Sand Castle incident is C++.** Shipping the enum while
leaving that exact provider at `ZERO_FILES_CAUSE_UNKNOWN` would make the new field correct and
**inert on its strongest known case** — the unreachable-remedy pattern this project keeps
rediscovering, committed inside the fix for another instance of it.

So cpp-clangd gains the explicit typed note immediately after the witness-checked `readLedger` /
pending-files result and before clangd startup, when the verified remainder is empty. One producer
assertion feeding the contract — not semantic expansion, and not inference in the wrapper.

`ZERO_FILES_CAUSE_UNKNOWN` stays correct **only** where a producer genuinely has no authority.

## Claim ceiling

`index.zeroFilesProcessedReason` names **the mechanism the producer asserted**. It is not a claim about clangd's
internals, not a claim that the repository has no callers, and not a completeness statement.

## Controls

- **positive, per value** — one test per reason proving each is reachable, `ZERO_FILES_CAUSE_UNKNOWN`
  and `UNKNOWN_CONFLICT` included. A branch nothing can hit is decoration.
- **positive, healthy run** — a normal run omits the **whole field** . Without this, an
  unconditional field would satisfy every other assertion.
- **negative** — a budget-exhaustion note with `filesProcessed > 0` must **not** produce a reason. This is the discriminator the whole design rests on, so it is asserted directly.
- **orphaned-ledger, the REQUIRED HOSTILE TEST** — the historical incident, reproduced: a valid
  ledger plus an absent, unreadable or zero graph witness must reset, must **not** emit
  `already_collected`, and therefore must **not** surface `ALREADY_COMPLETE`. **A surviving raw
  `resumedFrom` derivation fails this test**, which is exactly what makes it worth having.
- **C++ hostile sequence, end-to-end** — valid ledger + surviving graph witness + exhausted
  verified remainder ⇒ `ALREADY_COMPLETE`; the **same** ledger with an absent, unreadable or zero
  witness ⇒ ledger resets, work is processed (or another honest outcome), and `ALREADY_COMPLETE` is
  **impossible**.
- **provider asymmetry** — kept **only until the C++ producer note lands**. ⚠ A knowingly temporary
  gap must not be encoded as the final contract.
- **consumer** — a call-site test proving the intended decision/render path actually reads the
  field. Without it, placement changes nothing and repeats the true-value-no-reader defect.
- **envelope shapes** — both cpp-clangd and generic LSP, since their note vocabularies differ.
- **mutant per branch** — each derivation is inverted and watched to fail.

## What this will not do

It will not make the integration test's 9 s budget load-safe, and it will not attribute the
already-observed red run — that event stays **unattributed**, as ruled. It makes the *next*
naturally occurring zero attributable, which is the whole point of not chasing this one.
