# M1a step B — the production-consumer arm: **disposition B**

Carrier: `scripts/step-b-caller-isolation.mjs` · Fixture: `tests/fixtures/identity-callers/`
Receipt: `receipts/caller-isolation-c4e99c9.txt` · Suite: `receipts/suite-2aaf671.txt`
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

Pre-B collapsed alpha's and beta's definitions into one candidate and their declarations into
another. **An agent reading the pre-B output sees what looks like the decl/def pair of a single
symbol; `beta` is not mentioned at all.** It is not a partial answer, it is a confident wrong one:
two distinct symbols rendered as one.

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

Across both arms: **4 CALLS edges, 4 landing on `External`, 0 on a `Method`.** Without a compile
database, `w.render()` resolves to an unresolved External stub rather than to any definition, so
caller attribution is not merely unproven for this fixture — it is structurally unavailable, and
identically so in both checkouts. Step B neither improved nor harmed it.

The predicted failure was name-keyed **fanout** — one edge attaching to *both* definitions. The
actual failure is sharper: the edge attaches to **neither**.

### ⚠ My control was insufficient, in the way the review warned about in spirit

The preregistered post-import control asked *"do CALLS edges exist, and do both caller labels exist
as source nodes"*. Both passed. Neither asks the question that mattered — **do those edges reach a
definition**. A non-empty edge population that terminates on an External stub satisfies every check
I wrote while proving nothing about attribution. "Non-empty" is not "relevant", and I had already
been told once this session that an absence has to be distinguished from an instrument that cannot
see. The right control asserts the edge's *target type*, not the edge's existence.

## What step B has and has not earned

**Earned.** The shipped output for a same-name-different-namespace query moves from conflated to
namespace-pure, in both the bare and the qualified form. This is a consumed behavioural change on
a decision route an agent acts on, and it is the one thing grep structurally cannot do: a text
search for `render` returns four hits with nothing to say two of them are a different symbol.

**Not earned.** No caller-set correctness whatsoever. No claim that the candidate population is
semantically correct — decl/def forks remain, so post-B lists alpha twice and beta twice, and that
exact defect is stated rather than dressed up. No claim about C++ caller attribution at all.

**Next binding defect:** C++ CALLS edges terminating on External stubs without a compile database.
That is upstream of identity and blocks any caller-set claim regardless of how good the partition
gets. It is not step B's to fix, and it means M1's "return the qualified candidates **with their
caller sets**" cannot complete on this evidence.

## Claim ceiling

One fixture, three files, two namespaces, no compile database. The candidate-level result is a
measurement of the shipped verb on two independently built graphs; the attribution result says only
that this fixture cannot test attribution. Neither is a claim about a real repository at scale —
that is M5.
