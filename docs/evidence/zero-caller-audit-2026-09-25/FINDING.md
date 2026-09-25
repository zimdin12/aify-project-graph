# A second wrong-zero class, alive at HEAD, and invisible

2026-09-25, at `d257f8e5`. Run because dashboard-manager asked a question nobody could answer from
notes: **is there any measurement of apg's effect on agent work taken AFTER the recent fixes?**

**The answer to that question is no.** No evidence directory here is dated after 2026-09-18, and HEAD
has not moved since 2026-09-20. Nothing has measured apg's effect on agent work after the file-scope
caller fix (`d0132af2`), after the resolver perf work, after the default surface was cut, or after the
founding-question fix. That is the honest state: **unmeasured, not improved.**

Three things WERE measured today, each with its controls in the same pass.

## 1. Empty caller sets: one verified wrong zero, still live, silent

No check of this existed. `audit.py` is the one built for it: sample functions the graph says nothing
calls, then look for call-shaped occurrences with ripgrep, which is independent of the graph.

| Control, same run | Result |
|---|---|
| FRESHNESS — graph's indexed commit equals HEAD | `d257f8e5` both, SAME TREE |
| POSITIVE — functions the graph says HAVE callers must show call-shaped occurrences | 10 of 10 |
| NEGATIVE — a fabricated name must show none | 0 occurrences |

Population: **121** zero-caller Function/Method nodes among 1,565 (non-test, non-script, non-reference).
Sample: 25, seed 20260925. **10 showed call-shaped occurrences.**

⚠ **The instrument matches by NAME, so most of those 10 are collisions** — `enrich`, `detect`, `add`,
`start` are methods on unrelated objects, which is the same name-is-not-identity trap the staleness work
already recorded. Nine remain unclassified. **One was verified end to end:**

### `graphPacket`, verified

- The graph reported **0 incoming CALLS**, and **no `unresolved_refs` row either**. Not refused, not
  deferred: dropped, silently.
- **The control is inside the same function.** `run()` in `scripts/demo-verify-ab.mjs` calls
  `graphHealth` at lines 51-52 and `graphPacket` at 54-55 — same shape, same import style, adjacent
  lines. `graphHealth` had 25 caller edges. `graphPacket` had none.
- **Extraction is not at fault.** Running `extractFile` directly on that script emits 3 CALLS refs for
  `graphPacket` and 2 for `graphHealth`, and resolves both import specifiers. The loss is after
  extraction.
- **A forced rebuild fixed it: 0 -> 18 incoming CALLS.** The graph a reader actually had at this commit
  was missing every caller of that symbol.

### The mechanism is NOT identified, and my first hypothesis is refuted

Hypothesis: editing the defining file re-mints its site ids (they are hashed from byte spans) and orphans
incoming edges from files that were not re-extracted.

Test: inserted a comment above the definition in `packet.js`, ran ONE incremental index, and re-counted.
**The 18 caller edges survived.** The hypothesis is wrong, the file was reverted, and the tree is clean.
Something else produced the zero. It is not guessed at here.

### Why this matters more than the count

`d0132af2` fixed one cause of empty caller sets (calls at file scope, dropped for every language except
C++; on this repo that took non-test zero-caller functions from 500 to 170). **This is a different cause,
it survived that fix, and it announces nothing.** An empty caller set is the answer that licenses a
delete.

## 2. The per-session surface tax: re-measured, and it went UP

Re-ran `scripts/m4-tools-list-cost.mjs`, which spawns the shipped server and weighs a real
`initialize` + `tools/list` response rather than reimplementing the selection rule.

| profile | tools | bytes | schema share |
|---|---|---|---|
| default | 16 | **25,818** | 69% |
| full | 32 | 46,131 | 70% |
| lean | 6 | 11,771 | 58% |
| code-intel | 11 | 22,158 | 61% |

Controls: every profile returned a non-empty list; an unknown profile fell back to default.
**2026-09-01 measured 25,539 for the same 16 verbs; today is 25,818, up 279 bytes**, with five commits
touching the surface files in between. Raw output: `tools-list-cost-2026-09-25.txt`.

## 3. One old defect no longer reproduces

`graph_change_plan ensureFresh` was recorded as returning `RISK SAFE` against roughly 130 occurrences in
31 files. Today it returns:

    RISK CONFIRM — 51 callers across module boundaries
    SIGNALS 51 caller(s), 6 of 37 dependency file(s), 0 test file(s)

Independent count: 66 files contain the name, 257 occurrences (that count includes imports, comments and
the definition, so it is an upper bound, not a caller count).

## ⛔ The confound that outranks the good news

**Both good numbers above were taken after a forced rebuild.** The graph a user has is built
incrementally by the commit hooks. The `graphPacket` finding proves an incremental graph at the same
commit can be silently missing edges a forced rebuild restores — so a defect can be fixed in the code and
still be wrong in the answer an agent receives. Until that gap is understood, no claim that the
wrong-zero class is closed is a claim about what agents are told.

## What would close it, in order

1. **Find the mechanism.** Reproduce the incremental history of a few commits in a clone, then diff its
   edge set against a forced rebuild at the same commit. One script, one run.
2. **Re-run this audit with a FILE-SCOPED instrument** instead of a name-based one, so the nine
   unclassified candidates resolve either way.
3. Only then discuss whether the class is closed.

## Claim ceiling

n=25 on ONE repository, with ONE instrument, and one verified case. This does not establish a rate. It
establishes that the class is not closed, which is the thing the roadmap's abandon rule needs to know.

## Files

`audit.py` (the instrument), `audit-output.txt` (its raw output, including the population and controls),
`tools-list-cost-2026-09-25.txt` (the re-measured surface tax).
