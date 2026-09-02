# ⛔ THIS PROPOSAL REINVENTED SOMETHING THAT ALREADY EXISTS. Withdrawn and replaced with the finding.

## What I wrote, and why it was wrong

I proposed a decision-shaped rubric for M5 ("is it safe to delete X", scored from a structured
`VERDICT:` line) and started implementing it in `scripts/ab-runner.mjs`. I did not first ask
whether a correct implementation already existed — the question that saved real work one cycle
earlier, on M2.

**It exists, and it is better than what I proposed:**

- `scripts/lib/ab-rubric.mjs` — a BLIND rubric (never told which arm produced a transcript), whose
  primary endpoint `unsafeAuthoritativeConclusion` is **three-valued** (`true` / `false` /
  `ambiguous`), explicitly so it cannot fail open. Mine was binary.
- It derives the verb list from `mcp/stdio/tools/schema.js` — the real registry, 43 tools — and its
  header records that an earlier version hardcoded twelve and would have scored an agent reaching
  for `graph_callees` as "did not use the graph".
- `tests/fixtures/linkage-scope/ground-truth.json` — PREREGISTERED ground truth with six classes
  (internal linkage, no-header external declaration, unity build, header-exposed, dynamic boundary,
  torn graph), plus `successDefinition`, `knownRouteGap`, `notReachedRule`, `freezeRule` and
  `corpusHygiene`.
- `tests/unit/ab/rubric-cannot-fail-open.test.js` — pins the branches that must not resolve to
  "safe", including a hedge followed by a go-ahead.

Its `successDefinition` is sharper than anything in my proposal: *"An agent that correctly uses
grep/Read instead of a floor-valued graph verb is a SUCCESS, not an adoption failure."*

My `evaluateDecision` was also in the wrong file — `ab-runner.mjs` calls `main()` at import, so it
is not importable by a test. **Reverted, uncommitted, gone.**

## ⭐ THE ACTUAL FINDING: the decision rubric is UNREACHABLE

```
grep -rl "ab-rubric.mjs|scoreTranscript"  ->  scripts/lib/ab-rubric.mjs
                                              tests/unit/ab/rubric-cannot-fail-open.test.js
grep -rl "linkage-scope" docs/            ->  (nothing)
```

**No runner imports it.** `scripts/ab-runner.mjs` — the harness that actually spawns Codex arms —
uses `ordered_contains` and `groups` from `tests/ab/tasks.mjs`, and never touches `scoreTranscript`.
The only consumer of the decision rubric is its own unit test.

⇒ This is the zero-consumer shape this project has now hit repeatedly: a careful, well-tested
component that nothing in the product path can reach. The rubric is not missing. **The wiring is.**

⇒ **M5's blocker was misdiagnosed.** `PREREGISTRATION.md` says the rubric "is not settled", and that
was true of the retrieval rubric in the OLD harness. A settled decision rubric was built afterwards
and never connected. The remaining work is to run the existing harness through the existing rubric —
which costs no agent budget to build, only to run.

## The one gap my measurements do identify

The six ground-truth classes cover linkage and scope. Searching the key: **`macro` and `ifdef`
appear nowhere.** From this week's measured table, the macro case is the ONLY construct blind to
BOTH tiers — which makes it the natural **known-loss control**: a class the graph arm is expected to
get wrong, so the benchmark cannot consist solely of cases the tool was built to win.

⛔ **That must NOT be added to the frozen key.** Its own `freezeRule` says the census is *"not
licence to redesign toward the test"* and that the frozen version runs unchanged, with new questions
opening *"as a new product slice with a new exact version and new preregistration"*. A macro class
therefore belongs in a NEW version, preregistered separately, after the current one closes — not as
an edit to a key that was written before any arm ran.

## Verification of the unreachability claim — upgraded 2026-09-02

⚠ The first version of this finding rested on a filename grep across `scripts/`, `tests/`, `docs/`,
and I flagged it as such: the reference resolver DECLINED to certify it (`ready:false`,
`cause:cold_index`), which is the M2 absence contract working correctly. Re-checked over the WHOLE
repository including dynamic imports:

```
grep -rn "ab-rubric|scoreTranscript"  (whole repo, all file types)
  scripts/lib/ab-rubric.mjs                        the definition
  tests/unit/ab/rubric-cannot-fail-open.test.js    3 static + 3 dynamic imports
  docs/…                                           prose only
```

**No runner, no script, no verb imports it.** The only executing consumer is its own unit test. The
claim now rests on a population that includes `await import()` forms, which the first pass would
have missed.

## What I am not claiming

I have not read the full rubric implementation or run it against any transcript, and I have not
designed the runner. Whether the wiring is a small job or a large one is UNMEASURED — the
ground-truth key references a "tier B" whose design I have not located, and inventing one would be
the same mistake this document already records once.

---

## ⛔ CORRECTION 2026-09-02 — "a tier B design I could not locate" WAS FALSE, and I used it to not build

I wrote that the wiring was blocked on a **"tier B" design the ground-truth key references and I
could not locate**, and repeated it as a reason to leave M5 untouched. It is wrong. I asserted it
from a shallow grep and never opened the fixture directory.

**`tier` is a PER-CLASS FIELD, not a missing document:**

```
A  PURPOSE-BUILT QUALIFICATION (C1,2,3,5) — can the rule distinguish the mechanisms at all?
   "Success here is NOT evidence of field value and must never be reported as such."
B  REAL PINNED SNAPSHOTS (C4,6) — the product-value estimate: route, adoption, decision utility.
analysisRule: report per tier, per class, per runtime. NEVER average synthetic and real into one
   "X% better" headline.
```

**And everything the experiment needs is already in the tree:**

| piece | where | state |
|---|---|---|
| corpus | `tests/fixtures/linkage-scope/corpus/` | 7 C++ files present |
| exact prompts | `tests/fixtures/linkage-scope/prompts.json` | present, with a LEAK RULE and 19 forbidden words |
| ground truth | `tests/fixtures/linkage-scope/ground-truth.json` | 6 classes: symbol, files, question, truth, `cheapestAuthoritativeRoute`, `graphShouldWin`, `unsafeAnswer`, tier |
| rubric | `scripts/lib/ab-rubric.mjs` | blind, three-valued, verbs from the real registry |
| analysis rule | the `tiers` block | present |
| **runner** | — | **THE ONLY MISSING PIECE** |

⇒ **The blocker was mine, not the repo's.** This is the same defect I corrected in the plan's M3b
bullet hours earlier — *naming a blocker without checking it*, which stops work at the wrong place.
I did it to myself, in the document that records me doing it to the plan.

⇒ **Building the runner costs NO agent budget.** Only running it does. The budget question is
genuinely Steven's; the wiring never was.

⚠ Still not established: whether `graphShouldWin` per class matches reality — that is what the run
measures, and 4 of 6 classes say the graph should NOT win, which is what makes this key credible
rather than flattering.
