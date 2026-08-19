# Efficacy evaluation — design v2 (pre-registered)

**Status:** design, not run. v1 was reviewed by graph-senior-dev before any measurement and
**failed review**. Everything below is the corrected version; v1's flaws are kept in place
rather than deleted, because the point of a pre-registered design is that its history is
visible.

## The question

> Is this still good for agents? Is it a good map and knowledge system? Does it improve
> quality, and does it decrease token usage?

Three separable claims that can come apart, plus a fourth this project cares about more than
any of them: **when the tool is incomplete, does it say so.**

## ⛔ Why v1 was withdrawn

The reviewer was asked to find the way the design produces a *confident wrong number*. They
found four, and the first is fatal on its own:

**1. The outcome table scored equal failure as help.** Worked counterexample, on paper:

| | correctness | false claims | chars |
|---|---|---|---|
| GRAPH | 0 of 6 | none | 100 |
| CONTROL | 0 of 6 | none | 200 |

v1's first row — *"≥ correctness AND fewer tokens → the tool helps"* — fires. **Nothing
helped.** Both arms failed absolutely; one failed more tersely. There was no absolute quality
floor anywhere in the design. A second contradiction sat in the prose: *"≥ correctness, MORE
tokens → it buys quality at a cost"* — equality buys no quality. And `≥` over per-task
yes/partial/no was undefined without a preregistered aggregation, so an average could hide
DELETE-SAFETY losing while LOCATE won.

**2. The arms were not one variable, and not the shipped product.** v1 compared graph-verbs
against Grep — *substitution* — while the skill's actual recommendation is MIXED mode. It also
denied the graph arm Grep/Glob artificially, and bundled at least three treatments (live verbs,
static brief, skill guidance) into one arm.

**3. Ground truth was the control arm's own method promoted to referee.** "Exhaustive grep +
read, never revised" structurally rewards lexical answers and can rule a compiler-backed answer
false. It is not exhaustive for overloads, macros, templates, generated bindings, reflection or
string registration, build/config references, external ABI consumers, dynamic dispatch, or
conditional compilation. And DELETE-SAFETY is *counterfactual* — no amount of grep establishes
it. I had flagged this objection myself and could not see my way around it; the reviewer's
answer is below and it is better than abandoning the task class.

**4. `chars/4` cannot support a token claim.** It is the product's own budgeting heuristic, and
the bias is *arm-correlated*: source code, structured graph output, and path-heavy prose have
different real chars-per-token ratios. It also excluded skill, brief, system and tool-schema
overhead, tool-call arguments, and the final answer — precisely the things the treatment adds.

## Estimand — decided before running

**Primary: product/bundle efficacy.** Not "graph verbs vs grep".

- **BASELINE** — normal prompt, Read + Grep + Glob.
- **AUGMENTED** — *identical* prompt and tools, PLUS the shipped skill, the static brief, and
  the graph/code-intel tools.

The variable is **"the installed aify bundle"**. Component attribution (brief-only vs
live-verbs-only vs full) is a later, factorial question that a case series of this size cannot
support, and will not be claimed.

## Safety gate — absolute, not comparative

Evaluated on its own, before any comparison, and it can fail the eval by itself:

- `tool_false_claim` — the tool stated something untrue.
- `final_answer_false_claim` — the agent's answer to the user was untrue.

Recorded **separately**: a false tool statement the agent catches is a product-honesty failure
but not the same efficacy outcome. "False" means an atomic factual proposition contradicted by
adjudicated evidence. A **disclosed** unknown or stated limit is explicitly *not* a false claim
— that is the product working as designed.

## Outcome model

1. **Absolute floor first.** "Helps" is not a legal conclusion unless AUGMENTED clears a
   pre-declared absolute success bar. Equal failure plus fewer characters is published as
   **"both arms failed; no efficacy conclusion"**.
2. **Paired task-level results published in full.** No single aggregate verdict, and no
   cross-task average may erase a safety regression.
3. **Split conclusions, which may disagree:** quality delta · safety gate · measured token
   delta · wall-time delta · map/orientation judgement.

## Ground truth — versioned reference set, not a frozen oracle

Freeze a **versioned reference set** plus an adjudication protocol, not an answer key:

- If an arm surfaces evidence the reference set omitted, **quarantine that task**, adjudicate
  independently from source/compiler/build evidence **while blinded to which arm surfaced it**,
  version the truth set, and re-run.
- Never force observed reality to lose because the preregistered oracle was wrong.

**Task-specific authorities**, because one referee cannot serve four questions:

| Task | Authority |
|---|---|
| LOCATE | symbol contract + source declarations + independent compiler/LSP/AST evidence, with explicit inclusion rules for generated and preprocessed surfaces. ⚠ Never the graph's own imported clangd facts as sole referee |
| IMPACT | specify the exact signature mutation, apply it in a disposable tree, **compile and test**. Observed breakage and inferred external risk reported separately |
| DELETE-SAFETY | "safe to delete" is **not** derivable from zero grep hits. Score `known unsafe` or `no in-scope dependency found under surfaces X`. Deletion + build + tests + API/config/generated scans. External consumers remain unknown unless scope excludes them explicitly |
| ORIENT | maintainer file lists are a *preference set*, not truth. Preregistered rubric — relevant anchors, relations, tasks, risks, false relations, actionable next step — rated blinded, ≥2 raters |

## Token accounting

- Characters are reported **as characters**, never converted and called tokens.
- A token claim requires counting the exact serialized messages and tool payloads actually
  injected, with the evaluated model's tokenizer or provider usage telemetry.
- Declare in advance whether the target is **context tokens, uncached billed tokens, or total
  input+output**; report cached separately.
- Include cold-start skill/brief/schema cost, and optionally an explicitly amortised multi-task
  view. Count final answers.
- `chars/4` survives only as an **internal budget estimate**, never as observed model tokens.

## Sampling and sessions

- A **pre-registered case series**: "on these tasks, these repo commits". No rate, no
  generalisation language, no confidence intervals from six points.
- Freeze before any arm runs: exact tasks, expected answer schema, task-class counts,
  difficulty and edge strata, stopping rule.
- Preferred: an independent maintainer enumerates the eligible population, then deterministic
  stratified sampling with a **published seed**.
- Strata must include the mundane *and* the adversarial: found / not-found, unique /
  multi-definition, weak / stale / fresh graph, code-intel present / absent, C++ overload /
  macro / template, deletion safe / unsafe / unknown.
- **Fresh isolated session per task per arm.** Identical model, runtime, settings, tool budget.
  No cross-arm conversation or cache. Randomised, counterbalanced order. One agent doing both
  arms carries the answer from the first into the second, and admitting non-blinding does not
  remove that.
- Carrier recorded per run — not just `server.buildId`: prompts, tool schemas/profile, skill and
  brief hashes, graph DB/manifest commit, overlay hash, code-intel provenance and freshness,
  model settings, OS, and arm order.

## "Good map" is currently unmeasured

One ORIENT file-overlap task does not test feature relations, task/owner knowledge, stale-map
disclosure, path usefulness, or whether the map leads to a *correct plan*. Either the map gets
explicit metrics and a rubric, or the published question narrows to locate/impact/delete
assistance and says so.

## What this design can support

A **smaller but defensible statement**: paired, task-level results on a named case series, with
an absolute false-claim gate, real token accounting, and separated conclusions. It cannot
support "the tool is good for agents" as a general claim, and will not be written that way.

## ⚠ Correction to a number already published

`badeeb0` reported packet output at 4720 → 4185 characters (−11.3%) between `9626b30` and
`9da1ee9`, and the skill repeats it. Reviewer's objections, accepted:

- The **basis was not recorded**. For the record: both arms called the same `repoRoot`
  (`C:/Docker/aify-project-graph`) against the **same `.aify-graph` index and overlay**, with
  only the plugin code differing — so the target corpus was held fixed. That is what makes the
  comparison meaningful, and it belonged in the doc, not in my head.
- The **pairing gate was wrong**. "At least 5 of 9 real packets" does not establish pairing —
  five *different* successes per side would yield a plausible total. This run happened to be
  9/9 on both sides with per-target deltas published, so the comparison is paired in fact; the
  gate that permitted otherwise has been corrected to require all nine paired IDs.
- It is a **character count, not a token measurement**, and the `~tokens` figure is a heuristic
  restatement of the same number, not independent evidence.
- The causal sentence — "removing a recommendation that did not apply removed more" — is
  **not established by the aggregate**. It needs line-level paired decomposition. Downgraded to
  a hypothesis.
- The **+276 not-found packet** stays reported separately rather than disappearing into the
  sum; it is the paired case that shows the cost of naming both possible causes.
