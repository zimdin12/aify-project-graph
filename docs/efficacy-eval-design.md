# Efficacy evaluation — design v3 (pre-registered)

> **RUN STATUS: NO-RUN.** v3 is a defensible protocol scaffold, not yet an executable
> preregistration. the reviewer approves running it *as a descriptive paired case series*
> once the Appendix is filled with exact tasks, contracts, instrument and schedule. Until then
> no arm may be executed — a half-frozen preregistration is not one.

## The question

> Is this still good for agents? Is it a good map and knowledge system? Does it improve
> quality, and does it decrease token usage?

Three separable claims that can come apart, plus a fourth this project cares about more than
any of them: **when the tool is incomplete, does it say so.**

## ⛔ Why v1 was withdrawn

v1 was reviewed before any measurement and failed. The reviewer was asked to find the way it
produces a *confident wrong number*; they found four, and the first is fatal alone.

**1. It scored equal failure as help.** On paper:

| | correct | false claims | chars |
|---|---|---|---|
| GRAPH | 0 of 6 | none | 100 |
| CONTROL | 0 of 6 | none | 200 |

v1's first row — *"≥ correctness AND fewer tokens → the tool helps"* — fires. **Nothing
helped.** Both arms failed absolutely; one failed more tersely. There was no absolute quality
floor anywhere in it. A second contradiction sat in the prose: *"≥ correctness, MORE tokens →
buys quality at a cost"* — equality buys nothing. And `≥` over per-task yes/partial/no was
undefined without preregistered aggregation, so an average could hide DELETE-SAFETY losing
while LOCATE won.

**2. The arms were not one variable, and not the shipped product.** v1 pitted graph verbs
against Grep — *substitution* — while the skill recommends MIXED mode. It denied the graph arm
Grep/Glob artificially, and bundled at least three treatments (live verbs, static brief, skill
guidance) into one arm.

**3. Ground truth was the control's own method promoted to referee.** "Exhaustive grep + read,
never revised" structurally rewards lexical answers and can rule a compiler-backed answer
false. It is not exhaustive for overloads, macros, templates, generated bindings, reflection or
string registration, build/config references, external ABI consumers, dynamic dispatch, or
conditional compilation. DELETE-SAFETY is *counterfactual* and no amount of grep establishes it.

**4. `chars/4` cannot support a token claim.** It is the product's own budgeting heuristic and
the bias is **arm-correlated** — structured tool output, source code and path-heavy prose have
different real chars-per-token ratios. It also excluded skill, brief, system and tool-schema
overhead, tool-call arguments, and the final answer: exactly what the treatment adds.

## Estimand — decided before running

**Primary: product/bundle efficacy.** Not "graph verbs vs grep".

- **BASELINE** — normal prompt, Read + Grep + Glob.
- **AUGMENTED** — *identical* prompt and tools, PLUS the shipped skill, the static brief, and
  the graph/code-intel tools.

The variable is **"the installed aify bundle"**. Component attribution (brief-only vs
live-verbs-only vs full) is a later factorial question that a case series of this size cannot
support, and will not be claimed.

## Safety — TWO independent gates, neither collapsible into the other

I asked whether a tool falsehood the agent catches should be invisible to the verdict. It
should not — that is the product promise failing, whoever cleans up after it.

- **`tool_honesty_gate`** — FAILS if any invoked aify tool emits an atomic factual proposition
  contradicted by adjudicated evidence, **even if the agent catches it**. Blocks any clean
  "the installed bundle passed" statement.
- **`final_answer_safety_gate`** — FAILS if the answer delivered to the user contains such a
  proposition.

⇒ A caught tool lie publishes as *"tool honesty failed; agent recovered; final answer passed."*
Recovery is measured — `recovered_tool_false_claim`, correction calls, correction tokens,
correction wall-time — and its full cost stays inside the AUGMENTED totals.

⚠ The reverse must not happen either: a correct final answer is **not** rewritten as incorrect
because a tool lied beneath it. That would collapse the two carriers this split exists to keep
apart.

Scope, predeclared: propositions in tool output actually delivered to the agent, and
propositions delivered to the user. A returned-but-ignored false tool proposition still fails
tool honesty. **Disclosed** stale / partial / floor / unknown is never a false claim — that is
the product working as designed. BASELINE is scored symmetrically: its tools usually expose
evidence rather than assert conclusions, but no exemption is granted if one does assert.

## Outcome model — the floor is a per-task CONTRACT, not a number

A global "4 of 6", or a rubric percentage, would be arbitrary and would smuggle back the
cross-task aggregation this design forbids. The non-arbitrary floor is: **did this answer
satisfy the essential contract of the question asked?** Each task freezes `must`, `must_not`
and `allowed_unknown` before either arm runs.

| Task | `must` | `must_not` | `allowed_unknown` |
|---|---|---|---|
| LOCATE | all in-scope definitions **and the exact count**, per a stated identity contract | any false location | an explicit "incomplete/unknown" — passes SAFETY, does **not** pass efficacy for a question asking *how many* |
| IMPACT | the named mutation; every preregistered observed compile/test breakage; all declarations, overrides, bindings the reference set requires | presenting inferred external risk as observed | external consumers, if labelled inferred |
| DELETE-SAFETY | a correct **typed** verdict: `known unsafe` with the dependency, or `no in-scope dependency found under surfaces X` | an unqualified "safe" — a safety failure, not merely a wrong answer | anything outside the named surfaces, if scope says so |
| ORIENT | every must-have anchor/risk from the blinded rubric, plus ≥1 actionable next step | any false relation | dimensions the manifest marks non-essential |

**Paired conclusion rules, preregistered:**

1. AUGMENTED fails its floor → **no "helps" claim**, whatever it cost.
2. AUGMENTED passes, BASELINE fails → quality help observed *for this named run and task*; the
   token delta is then the **cost of a successful answer**, not a saving.
3. Both pass the same essential contract → **quality tie at the floor.** Optional rubric
   dimensions compared separately, and only then may lower measured tokens support a cost result.
4. Both fail → **both failed; no efficacy conclusion.** (The case v1 scored as "helps".)
5. One wins optional dimensions but loses an essential or safety dimension → **no averaging**;
   the essential/safety loss dominates.

**Split conclusions, which may disagree:** quality · tool honesty · final-answer safety ·
measured tokens · wall-time · map judgement.

## Ground truth — versioned reference set, not a frozen oracle

Freeze a **versioned reference set** plus an adjudication protocol, not an answer key:

- If an arm surfaces evidence the reference set omitted, **quarantine that task**, adjudicate
  independently from source/compiler/build evidence **blinded to which arm surfaced it**,
  version the truth set, and re-run.
- Never force observed reality to lose because the preregistered oracle was wrong.

**Task-specific authorities**, because one referee cannot serve four questions:

| Task | Authority |
|---|---|
| LOCATE | symbol contract + source declarations + independent compiler/LSP/AST evidence, with explicit inclusion rules for generated and preprocessed surfaces. ⚠ Never the graph's own imported clangd facts as its sole referee |
| IMPACT | name the exact signature mutation, apply it in a disposable tree, **compile and test**. Observed breakage and inferred external risk reported separately |
| DELETE-SAFETY | "safe to delete" is **not** derivable from zero grep hits. Deletion + build + tests + API/config/generated scans. External consumers remain unknown unless scope excludes them explicitly |
| ORIENT | maintainer file lists are a *preference set*, not truth. Preregistered rubric — relevant anchors, relations, tasks, risks, false relations, actionable next step — rated blinded, ≥2 raters |

## Token accounting

- Characters are reported **as characters**, never converted and called tokens.
- A token claim requires counting the exact serialized messages and tool payloads actually
  injected, with the evaluated model's tokenizer or provider usage telemetry.
- Declare in advance whether the target is **context tokens, uncached billed tokens, or total
  input+output**; report cached separately.
- Include cold-start skill/brief/schema cost; optionally an explicitly amortised multi-task view.
  Count final answers.
- `chars/4` survives only as an **internal budget estimate**, never as observed model tokens.

## Sampling and sessions

- A **pre-registered case series**: "on these tasks, these repo commits". No rate, no
  generalisation language, no confidence intervals from six points, no "usually", and no "the
  bundle improves agents".
- ⚠ **One run per cell is a trajectory, not an arm effect.** Prefer ≥3 fresh independent
  replicates per task per arm, all reported — never a mean-only headline. If budget permits only
  one, the language narrows to *"in this observed run"* and reproducibility is not inferred.
  Counterbalancing order does not remove sampling variance.
- Freeze before any arm runs: exact tasks, expected answer schema, task-class counts, difficulty
  and edge strata, stopping rule.
- ⚠ Strata are **published, not promised.** An earlier draft demanded found/not-found ×
  unique/multi × three freshness states × code-intel present/absent × C++ overload/macro/template
  × three deletion states. That is not a feasible balanced design at n=6, and demanding it would
  have produced a manifest claiming coverage it did not have. The manifest states which strata
  each task covers, which are **absent**, and forbids any claim about an absent stratum.
- A published seed has authority only if the eligible candidate population **and its hash** are
  frozen first.
- **Fresh isolated session per task per arm.** Identical model, runtime, settings, tool budget.
  No cross-arm conversation or cache. Randomised, counterbalanced order. One agent doing both
  arms carries the answer from the first into the second, and admitting non-blinding does not
  remove that.
- Carrier recorded per run — not just `server.buildId`: prompts, tool schemas/profile, skill and
  brief hashes, graph DB/manifest commit, overlay hash, code-intel provenance and freshness,
  model settings, OS, and arm order.

## ⚠ Blindness, operationally

Adjudicators receive a normalised atomic claim plus cited source/compiler/build evidence, with
arm labels and graph-specific phrasing removed where possible. If output style still reveals the
arm, **record blindness as compromised** rather than pretending it held.

## "Good map" is currently unmeasured

One ORIENT file-overlap task does not test feature relations, task/owner knowledge, stale-map
disclosure, path usefulness, or whether the map leads to a *correct plan*. Either the map gets
explicit metrics and a rubric with ≥2 blinded raters, or the published question narrows to
locate/impact/delete assistance and says so.

## Appendix — REQUIRED BEFORE ANY ARM RUNS

The reviewer's list, unedited in substance. Until every line is filled, this is a scaffold and
not a preregistration:

1. Exact task IDs, prompts, repos, commits, answer schemas.
2. Per-task `must` / `must_not` / `allowed_unknown` and authorities; versioned reference-set hash.
3. ORIENT rubric, two named blinded rating roles, tie/adjudication rule — **or** remove "good
   map" from this run and narrow the published question.
4. Exact candidate population and its hash; strata assignment; selection seed and method.
5. Replicate count, arm-order schedule, stopping/failure/rerun rule. ⚠ Apparatus failure must not
   silently become task failure, and reruns must not be selective by arm.
6. Exact token estimand and instrument — e.g. total serialized input+output via the model's
   tokenizer, cached/provider-billed separately — including skill/brief/schema cold-start.
7. Safety claim extraction and adjudication sheet, distinguishing tool carrier from final-answer
   carrier, and recording recovery.
8. Raw transcript/output retention path, plus the per-run carrier fields named above.

## What this design can support

A **smaller but defensible statement**: paired, task-level results on a named case series, with
two absolute honesty gates, real token accounting, and separated conclusions. It cannot support
"the tool is good for agents" as a general claim and will not be written that way.

## Measurement already retained, and its correction

`docs/measurements/packet-chars-9626b30-vs-9da1ee9.json` — the paired character measurement as
an auditable carrier rather than prose: all 9 case IDs, both arms, **raw output text for all 18
runs**, the fixed target corpus (same repo, same indexed commit, same overlay), and an explicit
`not_established` list. The pairing gate refuses unless all 9 IDs succeed on both sides.

Corrections applied to what was already published in `badeeb0` and the skill:

- The **basis was not recorded**. It is now: both arms called the same `repoRoot` against the
  same `.aify-graph` index and overlay, only the plugin code differing. That is what makes the
  pair meaningful, and it is the exact omission that retired the ">10 files" claim.
- The **pairing gate was wrong** — "at least 5 of 9 real" establishes nothing, since five
  *different* successes per side would pass it. Corrected to require all nine.
- It is a **character count, not token evidence**; the "−11.3%" restatement is withdrawn from
  the skill rather than footnoted.
- "Removing a recommendation removed more" is a **hypothesis**, not established by an aggregate.
- The **+276 not-found packet** stays reported separately — it is the paired case showing the
  cost of naming both possible causes instead of asserting one.
