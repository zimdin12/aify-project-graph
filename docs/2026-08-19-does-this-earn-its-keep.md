# Does this earn its keep? — the evidence, 2026-08-19

**The question, Steven's, unchanged:** *"is it still good for agents… does it improve
quality or and decrease token usage."*

**The short answer: our own null result is correct and now has company. The thesis has to
move, and the direction it moves in is better for us than the one we were defending.**

Built from: our LOCATE pilot (`docs/measurements/eval-locate-paired-result.json`, an
EXPLORATORY PILOT with five protocol deviations); a five-project reference audit; and a
survey of 2026 literature. Evidence tiers are marked and kept apart — **MEASURED**,
**PRACTITIONER**, **VENDOR**. A vendor blog saying "70% fewer tokens" is not evidence.

---

## 1 — Our pilot was not a mistake. It replicates.

We found no correctness advantage on six LOCATE tasks and more tool calls in the augmented
arm, and I treated that as a broken experiment. It is a result, and at least four
independent 2026 measurements agree.

- **Xu, "Does a Language Server Save Tokens for Coding Agents?"** ([arXiv:2608.13568],
  2026-06-29) — MEASURED. Tokens-to-success on symbol localization: Opus 4.8 **+6%** with
  LSP, Sonnet 4.6 **+118%**, Haiku 4.5 −26%. Its own abstract: *"The claim that semantic
  retrieval is more token-efficient is asserted almost everywhere and measured almost
  nowhere… The answer is conditional and usually negative."* Single-author, self-described
  preliminary.
- **CodeCompass** ([arXiv:2602.20048], 2026-02-23) — MEASURED, 258 trials. Graph condition
  **loses** on keyword-findable tasks (88.9% vs BM25's 100%) and on structural ones
  (76.4% vs 85.1%).
- **Codebase-Memory** ([arXiv:2603.27277], 2026-03-28) — MEASURED, 31 repos. The closest
  analogue to us: a tree-sitter graph behind MCP tools. Answer quality **0.83 vs 0.92** for
  a plain grep/read explorer, at ~1/10 the tokens. ⚠ The "10× fewer tokens" figure from this
  paper circulates widely; the 9-point quality regression is routinely dropped from the
  citation.
- **ManoMano "Project Aegis"** — PRACTITIONER. On simple lookup, Serena cost ~4× more and
  took 60% longer with no quality gain.

**Symbol location is at ceiling for grep.** Xu measures grep localization success at 100%.
There is no headroom to win. We spent the pilot measuring the one task class where we
cannot possibly help.

---

## 2 — The win is PRECISION, not recall. This is the correction that matters.

I had assumed a graph should find *more* callers than grep. The measurement says it does
not, and that the advantage is elsewhere.

Xu, on reference completeness — MEASURED:

| Arm | F1 | **Precision** | Recall | Tokens |
|---|---|---|---|---|
| grep-only | 0.706 | **0.76** | 0.67 | 1,136 |
| LSP-only | 0.778 | **1.00** | 0.66 | 1,347 (+19%) |

Recall stayed ≈0.66 across **all four arms**. The paper's conclusion: *"no tool helps the
agent find more true call sites — the missing third is an agent-thoroughness problem, not
a retrieval one."*

⛔ **PRECISION AND EXHAUSTIVENESS ARE ORTHOGONAL — do not let one become the other.**
`graph-senior-dev`'s correction, 2026-08-19, and it is load-bearing: precision says every
*returned* caller is real; `exhaustive` asserts that **none was omitted**, which is a recall
claim. The ~0.66 recall above is evidence **against** promoting precision into a completeness
attestation. Their P0 fixture had perfect precision and false exhaustiveness at the same time —
the one returned caller was real, and a second real caller was absent. That is precisely the
product risk, and it is why `exhaustive` now requires a fully covered, freshly measured
population (`7a46e4c`).

⇒ **Our measurable claim is zero false callers plus a truthful statement of what was
searched.** If we run the next experiment expecting to find more callers, we will get
another null. Correctness-of-absence is the thing — and it is exactly what licenses
*safe to delete*.

Corroboration from the other side, PRACTITIONER but author-conducted: CircleCI benchmarked
`vuejs/core` and found Sonnet+grep located **9 of 11** `trigger` references and **249 of
260** `effect` references — *"the LSP was the only configuration that never missed"* — and
critically, **the agent did not know it had missed them.**

---

## 3 — The ceiling, which changes the investment case

- **SweRank** ([arXiv:2505.07849]) — MEASURED. Downstream repair Pass@1 on SWE-Bench-Lite:
  best real localizer 24.5%, **oracle (perfect) localization 25.9%**. Perfect localization
  buys **3.3 points** over the best method available.
- **SWE-Explore** ([arXiv:2606.07297]) — MEASURED, 848 instances. Oracle exploration 59.7%
  vs Codex 50.3% — **~9 points** of total headroom.

⇒ **Even total success at our stated mission moves end-to-end outcomes by single digits.**
The investment case cannot rest on productivity. It rests on **not taking confidently wrong
destructive actions** — a safety argument. We should say so plainly instead of implying a
throughput win the evidence does not support.

---

## 4 — Adoption is the largest measured failure mode, larger than any retrieval effect

This is section 1 of `docs/2026-08-10-one-plan.md` — "why competent agents do not reach for
it" — with outside numbers attached.

- **CodeCompass** — MEASURED: **58% of graph-condition trials made zero tool calls** despite
  a system-prompt instruction. On structural tasks, **0 of 30**. Trials that used the tool
  scored 99.5%; trials that ignored it, 80.2%.
- **Serena issue #1491** — MEASURED, production telemetry over 21,089 tool calls / 192
  sessions: **64.6% of sessions never invoked a query tool.**
- **Xu** — MEASURED: agents chose semantic tools **0–6%** of the time on localization, but
  **45–57%** on reference tasks.

Two things follow. **Agents self-route by task class, and they route correctly** — which
independently confirms that LOCATE does not need us. And CodeCompass took G3 adoption from
85.7% to 100% purely by **moving a mandatory checklist to the end of the prompt**.

⇒ **Tool descriptions and prompt placement are currently worth more measured points than
index quality.** That is load-bearing engineering, not documentation — and it is the same
conclusion ef-manager reached from the field on the same day, independently, via the
schema-description asymmetry.

---

## 5 — The attestation is genuinely unclaimed, and the reason is structural

Machine-checked negatives, verified by enumerating schemas rather than searching opinions:

- **LSP cannot express it.** The 3.18 `metaModel.json` defines 69 requests. Exactly one
  property contains "incomplete" — `CompletionList.isIncomplete` — and it is a UI latency
  hint. Zero hits for *exhaust*, *coverage*, *truncat*, *confidence*.
  `textDocument/references`, `callHierarchy/incomingCalls`, `workspace/symbol`: **no
  completeness field on any of them.**
- **SCIP cannot carry it.** `Metadata = {version, tool_info, project_root,
  text_document_encoding}`. No field for files that failed to index.
- **LSIF cannot carry it.** Zero occurrences of exhaust/coverage/incomplete/truncat/partial.
- **Sourcegraph's GraphQL schema (269 KB) contains zero occurrences of "exhaustiv"**, and
  Sourcegraph does not attest on code *navigation* at all — find-references silently falls
  back to plain-text search with no in-band flag.
- **MCP has no slot.** `CallToolResult` carries only `isError`. ⚠ The 2026-07-28 revision
  adds `resultType: "complete" | "input_required"` — a **false friend** meaning "not
  awaiting client input". **Do not use that word in our schema.**
- **`scip-clang` computes our banner and throws it away**, printing `Skipped: 30
  compilation database entries` and `num errored TUs: 0` to a console, because SCIP has
  nowhere to put it.

Prior art that does exist, and we should stop implying it does not: Sourcegraph's streaming
`Skipped[]` with ten enumerated reasons; **Elasticsearch's `hits.total.relation: "eq" |
"gte"`** — literally exact-vs-lower-bound, since 2019; Semgrep's 17-value skip-reason enum.
Expect the objection *"this is `_shards` for code"*, because it substantially is. **Our
answer is the audience and the binding, not the concept:** a computed verdict rather than
raw facts, on symbol queries rather than text search, per-answer rather than a dashboard,
aimed at an agent's delete/no-delete decision.

**Documented incidents that justify the feature**, all real and public: Claude Code's Grep
reporting 0 matches where `rg` found 161 (`anthropics/claude-code#5256`, closed as not
planned); `vscode-cpptools#8156` showing "no results" with 21,341 files discovered and
1,031 parsed; `clangd#2046` returning references only from opened files; Serena's
`find_referencing_symbols` returning `{}` with `isError: false` after tsserver died of OOM
(`oraios/serena#1814`, open) — the reporter calls it *"the worst possible failure shape:
fast, confident, and wrong."*

**Terminology**: in static analysis "complete" conventionally means *no false positives* —
the opposite axis from ours. Use **exhaustive**. The soundiness manifesto (CACM 58(2),
2015) is the right frame and is unclaimed for agents.

---

## 6 — Two things that should worry us

**The persistent index may not be where the value lives.** CoSIL ([arXiv:2503.22424])
builds its call graph **on the fly via the LLM with no persistent index** and reports
SWE-bench Lite Top-1 of **43.3% vs LocAgent's 10.3%** at ~1/8 the token cost. LARGER
reaches the same architectural conclusion independently: anchor lexically, expand via graph
edges only where needed. ⚠ Read the LocAgent row cautiously — it was run under a non-native
model. But our own memory records repeated staleness and cache-invalidation defects, which
is precisely the cost CoSIL avoids by construction. **"Is the persistent index earning its
keep?" is a live question and our field experience is currently evidence on the sceptical
side.**

**The window on the core verbs is closing.** Claude Code now ships first-party LSP plugins
for 11 languages including C/C++, with call hierarchy. Serena occupies the LSP-MCP slot.
**Do not compete on "we can find references."**

---

## 7 — What to do

1. **Publish the LOCATE null.** It replicates four studies and is more credible than the
   vendor claims dominating this space. Stop treating it as a failed experiment.
2. **Stop measuring LOCATE.** Grep is at 100%. There is nothing to win.
3. **Measure hidden dependencies.** CodeCompass's G3 construction is reproducible: symbols
   sharing **fewer than 2 tokens with the task description after stopword removal**. That
   is the +21.2-point effect.
4. **Measure reference precision on same-named / overloaded / virtual C++ symbols.** Our
   strongest ground and lexical search's worst case.
5. **Measure deletion safety against a published bar.** A shipping dead-code detector using
   a knowledge graph has a documented **70% false-positive rate** on next.js (PRACTITIONER),
   caused by unresolvable CommonJS re-exports. Our claim is not "we find dead code" — it is
   **"we refuse when the population is incomplete."**
6. **Fix the pilot's metric.** Tool-call count is confounded: unresolved SWE-bench tasks
   average **12.95 calls vs 7.2 for resolved**, independent of tooling
   ([arXiv:2607.03691], 35 releases, model held constant). Adopt Xu's **tokens-to-success at
   equal task success**, which also makes our numbers directly comparable to his.
7. **Treat tool descriptions as load-bearing.** Bigger measured effect than index quality.
8. **`SWE-QA`** ([arXiv:2509.14635], ACL 2026 Findings) is a ready-made benchmark — 720
   questions, 15 repos — and **no code-graph or LSP arm has ever been run on it.**

---

## The one-sentence version

We are not building a better way to find things — grep wins that, and the evidence is now
unambiguous. We are building the only layer that can say **"I searched all 412 translation
units, three failed to parse, and within that population there are zero callers"** — a
sentence no shipping tool and no standard format can currently express, on the one verb
with the highest documented false-positive rate in the wild.

---

## Honest limits of this document

Most sources are 2026 preprints, mostly single-repo, single-model, rarely replicated; two
of the practitioner sources returned 403 and were read through a search index rather than
fetched. **Nobody has measured transitive caller closure, virtual/override resolution, or
"safe to delete" as agent task classes** with a controlled graph-vs-grep comparison —
targeted searches for each found nothing rigorous. That is the gap we are positioned to
fill, and it is also why every number above should be treated as a direction, not a
coefficient.
