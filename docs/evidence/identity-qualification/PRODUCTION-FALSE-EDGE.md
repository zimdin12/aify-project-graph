# The identity collision produces a false call edge in our own graph

Measured after M0b, on this repo's live graph. Not synthetic, not C++, not a fixture — and this is
the case where **grep would serve an agent better than we do.**

Evidence for commit `81b49e4`. ⚠ Line numbers below are recorded as evidence for that commit and
are **not** the durable oracle — an acceptance test must anchor on structural or snippet identity,
or freeze the source as a regression fixture, or it will rot on the next edit to the file and fail
for a reason unrelated to identity.

## The false edge

`mcp/stdio/query/verbs/code_intel_hierarchy.js` defines **two** local helpers named `expand`, each
with the identical declarator `async function expand(item, node, level)`:

- one at **:512**, local to `walkCallHierarchy` (:504)
- one at **:558**, local to `walkTypeHierarchy` (:553)

They are different functions in different scopes. The graph holds **one** node — `:512-545` — and
the `:558` one does not exist, deleted by the identity collision M0b isolated.

Incoming `CALLS` edges on that single node:

| from | callsite | verdict |
|---|---|---|
| `expand` @512 | :543 | genuine recursion — verified at source |
| `walkCallHierarchy` @504 | :547 | correct |
| `walkTypeHierarchy` @553 | :583 | **FALSE** |

Line 583 is `await expand(rootItem, root, 0);` inside `walkTypeHierarchy`. It calls the `expand`
defined at :558 — its own local helper. That function is absent from the graph, so the resolver had
exactly one candidate spelled `expand` and attached the edge to the wrong one.

**One of three incoming call edges is false, and nothing marks it.** Negative control: edges to a
fabricated id return 0, so the edge query can say absent.

## Why this changes the weight of M1a

The plan's standing test is whether we make an agent's decision better, faster or safer than grep
alone. On this symbol we are **worse**. `grep -n "function expand"` shows both definitions and lets
an agent see there are two. We show one and hang a caller on it that belongs to the other. An agent
asking "who calls `expand`" gets a confident, complete-looking answer containing a wrong edge — the
failure our absence-authority work exists to prevent, arriving through *identity* rather than
*coverage*.

## And the mitigation for this exact class is inert

`mergesOverloads()` (`ingest/resolver.js:159`) is the guard from the 2026-07-27 field report: stop
the resolver stamping EXTRACTED trust on a self-edge it cannot tell from an inter-overload call.
Run against every node in the live graph:

```
nodes in graph                                   6,103
nodes that COLLIDED (overload_signatures present)     6
nodes where mergesOverloads() FIRES                   1
```

| node | file | sigs | `overloads` | guard |
|---|---|---|---|---|
| `writeDb` | `tests/.../compile-db.test.js` | 1 | ABSENT | silent |
| `collect` | `tests/.../skip-counters-provider-boundary.test.js` | 1 | ABSENT | silent |
| `expand` | `mcp/stdio/query/verbs/code_intel_hierarchy.js` | 1 | ABSENT | silent |
| `render` | `tests/fixtures/identity-hostile/src/shapes.cpp` | 1 | ABSENT | silent |
| `clamp` | `tests/fixtures/identity-hostile/src/shapes.cpp` | 2 | 2 | **FIRES** |
| `render` | `tests/fixtures/identity-hostile/src/shapes.h` | 1 | ABSENT | silent |

Controls, same pass: a synthetic node with `overloads: 2` returns true; an empty node returns
false; and a **real** collided node (`writeDb`) returns false. The guard works — the silence is the
data, not a broken probe.

**Mechanism.** `mergesOverloads` is `(extra?.overloads ?? 1) > 1`, and the extractor sets
`overloads` only when the new signature **differs** from the stored one. Identical signatures — the
silent, more dangerous collision — leave `overloads` absent, so the guard is *structurally unable*
to fire there. Three of the six above are the hostile fixture; on this repo's own code the guard
fires **0 of 3**, including `expand`.

Its test passes because the fixture hand-sets `{overloads: 2, overload_signatures: [...]}` — a
shape the extractor produces only in the disclosed case. **Green test, inert guard, and the
population it was built for is exactly the one it cannot see.**

## Two gaps, kept distinct

1. The guard never fires on same-signature collisions.
2. Even a firing guard only downgrades **self**-edges. The false edge here is not a self-edge, so
   it would ship at full trust regardless.

⛔ **No patch to the guard is proposed.** It is a readout of the identity defect, and step A removes
the condition. Patching the disclosure would be treating the symptom.

⇒ **It is deletion evidence, contingent on the gate below.** Once the schema/version gate forces old
graphs to rebuild, `mergesOverloads`, the self-edge downgrade branch, and the callee renderer's
"ONE node merging N overloads" note should be **deleted** rather than retained as unreachable
compatibility code. Their tests are replaced by extraction-to-final-edge controls, not kept.

## What step A must prove here — and what it may not claim

Per review, step A's authority stops short of positive binding:

- both local `expand` occurrences survive as distinct site rows;
- the `walkTypeHierarchy` call is **not** attached to the `:512` occurrence;
- no confident false `CALLS` edge is emitted merely because one same-name candidate survived;
- (post-repair) **zero merge metadata anywhere**: `overload_signatures` population = 0,
  `overloads` population = 0, and every overload occurrence survives as its own row with its own
  `extra.signature`.

⚠ **AMENDED ON REVIEW — my first version of that last item was too weak.** I proposed "no node
carries `overload_signatures` while `overloads` is absent", which still permits the *disclosed*
two-signature merge: the same lossy model with better metadata. Step A's contract is **no occurrence
merging at all**, so the presence of merge metadata is itself evidence the repair failed.

Replacement controls, extraction through to final edge:

1. two overloads produce **two** site rows;
2. an old-ID mutant collapses them and **fails** the population assertion;
3. same-signature local twins **both** survive;
4. the production `expand` case emits **no confident edge to the wrong site** (unresolved is allowed).

⚠ Step A may **not** require the call to resolve positively to `:558`. Choosing the lexically
enclosing local function needs scope/binding resolution, which is step B/C. **Two retained sites
plus an unresolved or ambiguous call is a sound step-A outcome** — strictly safer than today, and
within A's claim ceiling. Requiring the correct positive edge now would either pull scope semantics
into A or invite a heuristic that passes this case for the wrong reason.
