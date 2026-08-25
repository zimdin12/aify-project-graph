# Preregistration — `safeDirtyCount` returns a typed unknown

**Status: PREREGISTERED, NOT YET IMPLEMENTED.** Written before any code changes, per
`the reviewer`'s instruction: *"Do not merely widen the regex to `dirty=(?:\d+|\?)`. First
preregister the semantic controls."*

Ruling reference: message `1787304084412-f7e8a3c6`.

## The defect

```js
function safeDirtyCount(repoRoot) {
  try { return getTrackedDirtyFilesSync(repoRoot).length; }
  catch { return 0; }
}
```

A failed git query reports **zero dirty files** — indistinguishable from a genuinely clean tree.

⛔ **The honest marker already exists, one line away, and this field ignores it.** The same
`snapshotLine` renders `indexed=?` and `head=?` when those are unknown, and `trust=missing` when the
count is unavailable. Three fields in one line report unknown honestly; `dirty` alone lies.

**Observed in the wild** while probing something else:

```
snapshotLine(REPO)  ->  "SNAPSHOT: indexed=? head=? dirty=0 trust=missing"
```

That call passed a bad argument, so the git query threw — and the line still claimed **zero dirty
files** while admitting it knew nothing else. That is the defect executing, captured by accident.

## Why this matters more than a display bug

`dirty=` is a **trust number**. It tells an agent whether the indexed source can still be believed.
A false zero says *"the graph matches your working tree"* at exactly the moment the tool has lost
the ability to check.

## The contract

```text
git query succeeds, zero tracked dirt  ->  0      (numeric)
git query succeeds, N tracked dirt     ->  N      (numeric)
git query FAILS                        ->  ?      (typed unknown, never 0)
```

## Preregistered controls

Each states **why its value differs between the honest and hostile worlds** — a predicate whose
value is the same in both cannot discriminate, and I have shipped one of those before.

### C1 — induced git failure yields unknown, never zero
- **Honest world:** git query fails, field renders `?`.
- **Hostile world (current code):** git query fails, field renders `0`.
- **Discriminates because:** the rendered token differs, `?` vs `0`, in the same position.
- **Induction:** point `repoRoot` at a non-repository directory. Verified to induce a real failure —
  git prints `fatal: not a git repository` and the current code returns `0`.
- ⚠ **The induction must be proven to induce.** A control that does not actually make the query fail
  would pass vacuously. The test asserts the failure occurred, not merely that the output looks right.

### C2 — an honest clean tree still renders numeric zero
- **Honest world:** clean tree, `dirty=0`.
- **Hostile world (a lazy fix):** everything renders `?`, so the field never says anything.
- **Discriminates because:** without this, C1 is satisfied by returning `?` unconditionally — which
  would destroy the field's usefulness while passing the control that motivated the change.
- ⛔ This is the positive control. Without it the whole change is satisfied by a function that has
  stopped answering.

### C3 — a genuinely dirty tree still renders a number
- **Honest world:** N tracked modifications, `dirty=N`, N > 0.
- **Hostile world:** the unknown path swallows real counts.
- **Discriminates because:** it pins that only the FAILURE path changed, not the success path.

### C4 — refactor-guard normalization preserves the field without collapsing unknown into zero
- `VOLATILE_LINE` currently requires `dirty=\d+`, which **cannot match** `dirty=?`.
- **Honest world:** the pattern accepts `\d+` or `?`, the line is excluded, `volatileLines` stays 1.
- **Hostile world:** the pattern still requires `\d+`, an unknown-dirty line falls through to the
  COMPARED set, and the guard's one exclusion silently stops applying — exactly the defect fixed in
  `cba2974`.
- **Discriminates because:** `volatileShapeOk` now requires `excluded.length === 1`, so a
  non-matching line makes the guard FAIL rather than pass vacuously.
- ⚠ **This widening must land in the SAME commit that teaches the producer to emit `?`.** Today no
  input can produce `dirty=?`, and a guard no input can reach is decoration. A test currently pins
  that `dirty=?` is NOT excluded; that test flips in this slice, by design.

## Falsification, registered before the run

If, after the change:
- an induced git failure still renders `dirty=0` → **the fix did not work**;
- a clean tree renders `dirty=?` → **the fix over-applied and destroyed the field**;
- `volatileLines` for any corpus row is not exactly 1 → **the guard's exclusion broke**;

then the change is wrong regardless of whether the suite is green.

## Explicitly out of scope

- `getTrackedDirtyFilesSync` itself is unchanged.
- The two related fail-open candidates found by the hazard inventory —
  `mcp/stdio/freshness/git.js:106` and `mcp/stdio/query/verbs/find.js:35` — are **separate slices**
  and are not bundled here. Both are reported to the referee for sequencing.
- `graph_health`'s dirty reporting is not touched; if it shares a source, that is its own slice.

## Verified BEFORE implementing: the catch can actually fire

A preregistered control is worthless if its induction cannot reach the code path. I checked, and
the answer was not obvious from reading one function:

- `getChangedFilesSync` (git.js:106) catches and returns `[]` — DELIBERATE, and the comment above
  it says so: "Returns [] on any git failure ... so callers can degrade gracefully instead of
  throwing."
- `getDirtyFileEntriesSync` does NOT catch. `execGit` has no try/catch either, so a git failure
  PROPAGATES.

Measured:

    getTrackedDirtyFilesSync(<non-repo dir>)  ->  THREW: Command failed: git status --porcelain

So the `safeDirtyCount` catch DOES fire, and C1 discriminates. Had the helper degraded to `[]` like
its neighbour, fixing the catch would have changed nothing and C1 would have passed vacuously —
the control would have "confirmed" a fix that fixed nothing.

⚠ AND THE ADJACENT FINDING: two git helpers IN THE SAME FILE have opposite failure policies. One
degrades to an empty list, the other throws. `safeDirtyCount` then converts the throw into a false
zero. The inconsistency is not itself the defect, but it is why the defect was easy to write.
