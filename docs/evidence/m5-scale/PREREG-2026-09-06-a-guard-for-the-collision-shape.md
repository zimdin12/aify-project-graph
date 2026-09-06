# Preregistered: a guard for the shape the existing one cannot see

**Written 2026-09-06 before the fix is implemented.** The threshold below was calibrated on a
population measurement taken first; the DECISION RULE for whether the fix is acceptable is fixed here
and is not revisited afterwards.

## The defect

`graph_callers("has")` returns 25 caller rows at `conf=0.90`, all collisions — verified in source
(`groups.has(rawId)` on a Map, `new Map().has()` in `buildIndex`). No warning of any kind fires.

The existing trigger in `mcp/stdio/query/verbs/callers.js`:

```js
const suspicious = (trust === 'weak' && resultCount < 10)
  || (occurrences >= 3 && resultCount < occurrences);
```

Exactly **one** node is labelled `has`, so `occurrences = 1` kills the second clause, and the first
requires *fewer than 10* results against 25+.

⇒ It encodes AMBIGUITY (many same-named symbols, few results). The real overcount is the mirror
image: **one symbol absorbing many spurious inbound edges from a builtin method name.** The warning
exists because of this exact symbol and cannot fire on it.

## The population, measured BEFORE choosing a threshold

Inbound `CALLS`/`INVOKES` edges per symbol, across the whole live graph:

```
symbols with >= 1 inbound call edge : 2578
leaf <= 4 chars AND fanIn >= 10     :   42   (1.6% of all)
leaf <= 4 chars AND fanIn >=  5     :   68
leaf >= 8 chars AND fanIn >= 10     :   57   (must NOT warn)

the <=4 && >=10 set, by fan-in:
  join:755  trim:259  has:253  Set:182  all:159  Map:119
  Date:97   add:95    some:93  now:71   exec:70  max:64
```

⚠ **Every name at the top of that list is a JavaScript builtin.** `has` is not even the worst case —
`join` absorbs 755 spurious inbound edges. This is the collision hypothesis confirmed on the whole
graph rather than on one symbol.

## The rule

Add one clause: **leaf name ≤ 4 characters AND `resultCount` ≥ 10 AND the result set carries no
LSP-verified edge.**

- **≤ 4 characters** because a short name in a name-based resolver is inherently collision-prone, and
  because it leaves the 57 long-name popular helpers untouched.
- **≥ 10** because below that the existing weak-trust clause already covers the case.
- **No LSP-verified edge** because a compiler-resolved result is not a name collision, and warning
  about one would undercut the trust spine's whole point.

## Decision rule, fixed now and not revisited

| | Requirement | Why |
|---|---|---|
| 1 | `graph_callers("has")` on the REAL SERVER emits the overcount warning | the motivating case |
| 2 | `graph_callers("inspectReadFreshness")` does NOT — 25 genuine callers, 20-char name | ⭐ THE NEGATIVE CONTROL. A guard that fires on everything is decoration, and this repo has torn out an always-on caveat before |
| 3 | The newly-warning population stays under **5%** of symbols with inbound edges | measured at 1.6%; if the implementation drifts above 5% the clause is wrong |
| 4 | Full suite green | no existing disclosure regresses |

**Abandon rule.** If requirement 2 fails — if the clause cannot separate `has` from
`inspectReadFreshness` — the approach is wrong and gets reverted rather than tuned until it passes.
Tuning a filter until it produces the answer I already believe is how a screen ends up selecting its
own result, and this project has that written down.

## Claim ceiling

⛔ The population measurement is one repository, JS/MJS. The 4-character threshold is calibrated on
it and is not a universal constant.
⛔ It warns; it does not filter. The collisions still appear in the answer, and deciding whether to
drop them is a separate question with a much higher cost of being wrong.
