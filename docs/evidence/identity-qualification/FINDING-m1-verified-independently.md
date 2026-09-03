# M1 verified independently — and my first attempt to verify it was VACUOUS

**Date:** 2026-09-03
**Why:** the plan marks M1a/M1b DONE. The standing instruction is to re-derive state and never trust
a progress claim, so this drives the verb on a fresh fixture the shipped tests have never seen.

---

## The result

`graph_callers("persist")` on two distinct symbols sharing one name:

```
AMBIGUOUS MATCH for "persist". 2 concrete candidates found:
- src::invoice::persist src/invoice.js:1
    -> 1 caller: chargeCustomer
- src::photo::persist src/photo.js:1
    -> 1 caller: uploadAlbum
⚠ Caller counts come from the heuristic graph and are a FLOOR, not an exhaustive set. For a
  trustworthy absence use code_intel_references (live, per-symbol evidence) or verify with rg.
Retry with a qualified symbol (Class::method / Namespace::Class::method) or use a file-specific query.
```

**The milestone's stop condition holds.** Each candidate carries its OWN non-empty caller set,
correctly attributed — `invoice::persist` → `chargeCustomer`, `photo::persist` → `uploadAlbum`. They
are not pooled. `rg persist` on this fixture returns four hits with no way to separate them, so this
is the differentiator the plan claims, working.

The answer also carries the floor disclosure and a next step that can change the answer.

---

## ⛔ My FIRST version of this check passed, and proved nothing

v1 used two classes with a `save` METHOD, called as `inv.save()`. The verb correctly refused and
qualified both candidates — and reported **"0 callers in the indexed graph" for both**. Resolving a
method call through a variable needs type inference, which the heuristic extractor does not do.

So "the caller sets did not merge" was satisfied by **two empty sets**. Two empty sets are trivially
disjoint. The property the milestone exists to prove was untested, and the run reported HOLDS.

★ **A disjointness claim needs NON-EMPTY sets, and nothing in v1 checked that.** v2 adds the control
that makes it real: count the candidates reporting zero callers, and call the result VACUOUS if any
does.

⛔ **And the control was on the wrong SHAPE.** v1's positive control used a uniquely-named symbol
called as a DIRECT function call, which resolves fine. It could never reveal that the ambiguous case
used a different resolution shape resolving nothing. **A control must exercise the shape under
test**, not merely prove the verb runs.

⚠ The verb itself was honest throughout — it said "a FLOOR, not an exhaustive set" in the same
answer. The failure was entirely mine: I read a vacuous pass as verification.

---

## What this does NOT establish

- **Method calls through a variable resolve to zero callers** on the heuristic path. That is a
  documented limit, disclosed in the answer, not a defect — but it means an agent asking about a
  method gets a floor of zero, and the qualification is doing all the work.
- One fixture, JavaScript, direct imports. No prevalence claim for C++, and none for real
  repositories — the gap M5 exists to close and which remains unmeasured.
