# M5 PREREGISTRATION — written before any run, and before any result is read

M5 is the milestone that earns an expensive A/B. The plan attaches a condition to it that is easy
to skip and expensive to skip:

> ⚠ **BUT THAT IS NOT THE ONLY CONCLUSION, and mis-attributing it would be its own defect.** If the
> graph loses because tool-discovery tax, stale state or false identity dominated, the cause is that
> component, not the premise.

So a bare win/lose number is not an admissible output. This document fixes the population, the
outcomes and the controls first, so a loss can be attributed rather than interpreted.

**Status: NOT RUN.** The A/B spends real budget and is Steven's call. This costs nothing and makes
the run interpretable whenever it is authorised.

## The confound this exists to remove

Every result in this arc comes from fixtures of a handful of files, where an agent objected that
**"the index is the thing UNDER TEST, not the instrument"**. At that size an agent can simply read
the repository, so the graph cannot win and a null result means nothing.

## Population — real repos, measured, already configured in `tests/ab/tasks.mjs`

| repo | tracked files | language |
|---|---|---|
| `lc-api` | 2,278 | PHP/Laravel |
| `mem0-fork` | 1,722 | Python + TypeScript |
| `aify-project-graph` | 1,291 | Node |
| `echoes_of_the_fallen` | 1,284 | C++ |
| `aify-claude` | **ABSENT on this machine** — excluded, not silently skipped |

Counts from `git ls-files`, measured 2026-09-01. Byte totals were NOT reliably measured (the `du`
pass returned 0 for two repos) and are therefore not reported.

⚠ **"the size where reading fails" is asserted, not measured.** 1,284–2,278 tracked files is far
past what an agent reads exhaustively, but no measurement here establishes a threshold. If a run
shows the grep arm simply reading the relevant subset, the repo was not past the threshold and the
result is void for that repo.

## Preregistered component outcomes — assigned BEFORE reading any result

Every task outcome must be labelled with exactly one. These are the plan's own five:

1. **identity failure** — the graph returned the wrong symbol, merged two symbols, or refused a name
   it should have resolved. (M1's failure mode.)
2. **route-not-reached** — the agent never invoked a graph verb that would have answered. Measured
   0.8% on subagent transcripts, so this is a live risk, not a hypothetical.
3. **surface-cost loss** — the graph arm lost on tokens/latency despite answering correctly. The
   `tools/list` price is 25,539 bytes per session, measured.
4. **stale-evidence loss** — the graph answered from an index behind the working tree.
5. **no incremental utility despite all preconditions met** — identity correct, route reached, cost
   acceptable, evidence fresh, and the answer still did not beat grep. **Only this outcome licenses
   the plan's stop condition** ("our value is orientation and structure only").

⛔ A loss labelled 1–4 is a defect in that component and must NOT be reported as evidence against
the premise. Deciding the label after seeing the number is how a component failure becomes a false
verdict about the product.

## Claim ceiling

- Per-repo, per-task. **No pooled win rate** across repos of different languages and sizes.
- A win on `graph_callers` says nothing about `graph_packet`. Verb-level claims need verb-level data.
- n per cell must be stated with every figure. The existing runner defaults to 3 repeats; three runs
  bound a claim about variance weakly and must not be reported as a rate.
- **Token and latency figures are measurements; "better decision" is a judgement** and must be
  labelled as such, with the rubric that produced it.

## Controls, required in the same pass

- **POSITIVE** — at least one task the graph arm should certainly win (a same-name ambiguity that
  M1 now resolves). If it does not win, the harness is broken, not the premise.
- **NEGATIVE** — at least one task grep should certainly win (a literal string with one occurrence).
  If the graph arm "wins" that, the rubric is measuring the wrong thing.
- **CONTAMINATION** — the runner already refuses arms whose commands touch `.aify-graph`,
  `graph-query.mjs` or `graph.sqlite`. A grep arm that read the graph is void, not a data point.
- **ARM IDENTITY** — each arm must report the toolset profile it actually ran under. An earlier A/B
  in this repo was void because both arms shared one process and one module load.

## Abandon rule, preregistered

- If the positive control does not win, **stop and fix the harness**. Do not report any other cell.
- If more than one repo is void (absent, or reading did not fail), **stop** — the population no
  longer establishes scale.
- If component outcomes 1–4 account for every loss, the stop condition is **NOT** reached and must
  not be invoked; the honest output is a component defect list.

## What is NOT preregistered here

⛔ **THIS PARAGRAPH IS SUPERSEDED (2026-09-02) AND IT COST A CYCLE.** It read:

> The rubric for "better decision" is not settled, and I am not inventing one to look complete. The
> existing `AB_TASKS` use `ordered_contains` against expected paths, which measures *retrieval*, not
> decision quality. Whether that is the right proxy is an open question and belongs in the
> authorisation conversation, not in this file.

Every sentence was true of the OLD retrieval harness, and the refusal to invent a rubric was right.
**But a settled decision rubric was built afterwards and this file never learned of it**, so a
reader — me, this morning — concludes the rubric is an open design question and starts building one.
I proposed one, began implementing it in `scripts/ab-runner.mjs`, then found the better one already
in the tree and withdrew the proposal. Left visible rather than deleted, because the wrong belief is
what a future reader needs to recognise.

**What actually exists:** `scripts/lib/ab-rubric.mjs` — blind to which arm produced a transcript,
primary endpoint `unsafeAuthoritativeConclusion` three-valued (`true`/`false`/`ambiguous`) so it
cannot fail open, verbs derived from the real 43-tool registry — with preregistered ground truth in
`tests/fixtures/linkage-scope/ground-truth.json` (6 classes, `freezeRule`, `knownRouteGap`,
`notReachedRule`) and `tests/unit/ab/rubric-cannot-fail-open.test.js` pinning the branches that must
not resolve to "safe".

⛔ **Nothing consumes it.** Verified across the whole repo including `await import()` forms: the only
executing consumer is its own unit test. `scripts/ab-runner.mjs` still scores with
`ordered_contains`/`groups`.

⇒ **The open question is not "what rubric" but "wire the one we have".** That costs no agent budget
to build — only to run. What remains genuinely unsettled: the **budget** (72 runs) and the **"tier
B"** design this key references and I could not locate. Inventing that is the mistake recorded above.
