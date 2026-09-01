# M1a step B — the production-consumer arm: **disposition B**

Carrier: `scripts/step-b-caller-isolation.mjs` · Fixture: `tests/fixtures/identity-callers/`
Receipts: `receipts/caller-isolation-c4e99c9.txt` (the original run, which found the gap the
instrument did not enforce) and `receipts/caller-isolation-final.txt` (with the eligibility
predicate and its positive control) · Suite: `receipts/suite-2aaf671.txt`
(`VITEST_EXIT=0`, 420 files, 3533 passed + 4 skipped)

Dispositions were fixed **before execution** so the result could not choose the gate:

- **A** — caller isolation succeeds → B closes extraction/partition *and* the consumer claim.
- **B** — isolation fails, but shipped output moves namespace-**conflated** → namespace-**pure** →
  B closes as a prerequisite with a bounded identity-presentation claim and **no** caller-set
  correctness; name-keyed edge binding becomes the next defect.
- **C** — nothing observable changes → the partition finding closes only the internal extractor
  substep; record "carrier produced, no load-bearing consumer demonstrated".

**Result: B.** Both halves of B are measured below, and reported as the two separate populations
the review required, because collapsing them would hide where the failure lives.

## Population 1 — target selection: step B changed the shipped answer

Bare `graph_callers("render")`, same frozen fixture bytes, each arm indexed from scratch by its
own code:

**pre-B (`8c1bdc3`) — 2 candidates for 4 real definitions:**
```
- Widget::render                    src/widgets.cpp:4
- src::widgets::Widget::render      src/widgets.h:8
```

**post-B — 4 candidates, every one namespace-pure:**
```
- alpha::Widget::render                   src/widgets.cpp:4
- beta::Widget::render                    src/widgets.cpp:8
- src::widgets::alpha::Widget::render     src/widgets.h:8
- src::widgets::beta::Widget::render      src/widgets.h:15
```

⚠ **Precisely what moved, and where.** Storage did not lose anything: step A retained all four
site rows in both arms. What changed is that pre-B **query grouping rendered four stored sites as
two candidate identities**, because `canonicalSymbolKey` groups by qname and alpha's and beta's
qnames were equal. Attributing this to extraction or storage would name the wrong layer — the loss
is in candidate grouping, downstream of both.

The consequence for a reader is unchanged: **an agent reading the pre-B output sees what looks like
the decl/def pair of a single symbol, and `beta` is never mentioned.** Not a partial answer — a
confident wrong one, two distinct symbols presented as one.

The qualified query moved too. `alpha::Widget::render`:

| | candidates |
|---|---|
| pre-B | the same two conflated rows — qualification could not isolate alpha |
| post-B | exactly alpha's declaration and definition, **zero beta rows** |

That is namespace isolation at the candidate level, and it is what B claims. Both arms still
**refuse** (`REFUSED_AMBIGUOUS`) because the decl/def fork leaves two groups within each namespace
— step C's obligation, asserted nowhere here.

## Population 2 — edge attribution: unavailable in **both** arms

**Zero caller sets were isolated, because no caller edge reaches either definition.**

```
alphaCaller  -> type=External  qname=null  (no file)
betaCaller   -> type=External  qname=null  (no file)
```

Across both arms: **4 CALLS edges, 4 landing on `External`, 0 on a `Method`.** `w.render()`
resolves to an unresolved External stub rather than to any definition, so caller attribution is not
merely unproven for this fixture — it is structurally unavailable, and identically so in both
checkouts. Step B neither improved nor harmed it.

⚠ My first reading of this blamed the missing compile database. **That was wrong**, and the
positive control below disproves it: the same shape appears in JavaScript, which uses no compile
database at all.

The predicted failure was name-keyed **fanout** — one edge attaching to *both* definitions. The
actual failure is sharper: the edge attaches to **neither**.

### ⚠ My control was insufficient, and the instrument now enforces what the transcript found

The preregistered post-import control asked *"do CALLS edges exist, and do both caller labels exist
as source nodes"*. Both passed. Neither asks the question that mattered — **do those edges reach a
definition**. A non-empty edge population terminating on an External stub satisfies every check I
wrote while proving nothing about attribution. "Non-empty" is not "relevant".

The transcript discovered that honestly, but only because a human-readable `qname=null` happened to
be printed. The instrument now **enforces** it: `attributionEligibility()` returns a typed
`AVAILABLE` / `UNAVAILABLE` verdict with exact counts and membership — never pass/fail — so an arm
that cannot measure attribution says so instead of reporting a caller absence that belongs to the
edge layer.

**With its own positive control**, because a guard that always answers `UNAVAILABLE` would pass
every arm unnoticed — the same class of dead instrument this arm had just demonstrated:

| population | verdict |
|---|---|
| C++ fixture, `w.render()` | `UNAVAILABLE / ALL_TARGETS_UNRESOLVED` — `{External: 2}` |
| JS fixture, `alphaHelper()` / `betaHelper()` | **`AVAILABLE`** — `{Function: 2}`, both callers covered |
| JS fixture, `w.render()` | `UNAVAILABLE / ALL_TARGETS_UNRESOLVED` — `{External: 2}` |

### ⛔ The unresolved method target is NOT a C++ problem

The third row is the one that generalises the finding. In the **JavaScript** fixture, a plain
function call binds to a concrete `Function` node, while a method call on the same objects in the
same file lands on an `External` stub. So the gap is not the C++ toolchain or a missing compile
database — **method-call edges do not bind to method definitions in this pipeline at all**, in
either language tested.

That is upstream of identity and independent of it: no amount of partition quality can produce a
caller set for a method whose call edges terminate on a stub. It blocks M1's "qualified candidates
**with their caller sets**" universally, not merely for C++.

## What step B has and has not earned

**Earned.** The shipped output for a same-name-different-namespace query moves from conflated to
namespace-pure, in both the bare and the qualified form. This is a consumed behavioural change on
a decision route an agent acts on, and it is the one thing grep structurally cannot do: a text
search for `render` returns four hits with nothing to say two of them are a different symbol.

**Not earned.** No caller-set correctness whatsoever. No claim that the candidate population is
semantically correct — decl/def forks remain, so post-B lists alpha twice and beta twice, and that
exact defect is stated rather than dressed up. No claim about C++ caller attribution at all.

**Next binding defect:** method-call edges terminating on External stubs — in **both** languages
tested, not only C++, and not caused by a missing compile database. That is upstream of identity
and blocks any caller-set claim regardless of how good the partition gets. It is not step B's to
fix, and it means M1's "return the qualified candidates **with their caller sets**" cannot complete
on this evidence.

## Claim ceiling

One C++ fixture of three files with two namespaces, plus one JavaScript fixture as the predicate's
positive control. No compile database in either. The candidate-level result is a measurement of the
shipped verb on two independently built graphs. The attribution result says only that these
fixtures cannot test attribution, and that the method-call binding gap reproduces in two languages
— not that it is universal across every language or call shape, which is untested. Neither result
is a claim about a real repository at scale; that is M5.
