# Plan — simplify what exists, then prove it reaches a consumer

**Written 2026-09-08.** Supersedes the ORDERING in `docs/PLAN-2026-09-06-two-tags.md`. That
document's findings stand and it remains the history of the delta arc; what is retired is its
active sequence, which still orders work that has since been withdrawn.

Driven by the round-4 review at `bf053cd5`, which was asked for scope and product judgement rather
than defects. Every pointer in it was re-derived against the pinned tree before this was written.

---

## 0. Why the previous plan had to be replaced rather than edited

`docs/PLAN-2026-09-06-two-tags.md` ends with the order
`S1 -> S2 -> S3 -> S4 -> S5(tag) -> D1 -> D2 -> D3 -> D4 -> tag`, and its D1 section orders the
`structural_digest` table. `./CHANGELOG.md` withdraws exactly that comparison: a stored digest cannot
be attributed to the source its named commit contained, because the indexer parses the working tree
and carries unchanged rows forward.

A fresh agent following the active plan would rebuild rejected work. The two tags are past events,
not upcoming milestones. D1 to D4 are not unfinished repairs.

⚠ The human-use trial remains UNMEASURABLE, not failed, and its window does not restart.

⚠ The goal still requires a human view of what changed. It does not require this implementation.
The existing Git-diff-against-current-graph view stays, labelled as **what the diff touches** and
not as historical structural movement. That distinction is already stated correctly at
`docs/PLAN-2026-09-06-two-tags.md` lines 71-80.

---

## 1. The claim record, corrected

Three figures were being carried with the wrong noun attached. The repository's own documents were
right; the summaries built on top of them were not.

| Claim as carried | What the instrument measured |
|---|---|
| "0 invocations from 1,059 subagent transcripts" as a graph-verb figure | SKILL invocations (`docs/2026-08-25-skill-reach-is-the-same-bottleneck.md`). The graph-verb figure in that same document is **7 of 1,049 sidechains, 0.7%** |
| "80% adoption" | **8 of 10** installed parent sessions across three repos (`docs/THE-GOAL.md`), with install and task class confounded, and a call is not a benefit |
| "recall is unmeasurable here" | The **doc-to-symbol reference layer** and its missing true-reference denominator (`scripts/doc-ref-recall-sample.mjs`) |

⇒ **Reach is a demonstrated problem. "Adoption, not index quality, is the binding constraint" is
not established.** We have evidence of both failed reach and false answers, and installing a
confidently wrong tool more widely makes the product worse. Retain known-positive task cases that
can reveal omissions; precision alone can improve while the useful answers disappear.

⛔ Do not repair this by reading the gated adoption outcome. The n gate stands.

---

## 2. What the product is, and what earns its place

A knowledge system for AGENTS. The competitor is an agent holding grep. What earns its place is
what grep cannot compose for the agent, on a graph accurate enough to trust.

**KEEP, because it buys that:** the file and document foundation; the feature, task and document
joins; the compact briefs and the packet entry point; multi-hop traversal; compiler-backed identity
and dispatch queries. `mcp/stdio/query/verbs/consequences.js` demonstrates the task-to-feature join.

**KEEP, because the failure modes still exist:** atomic rebuild and publication protection
(`mcp/stdio/storage/rebuild-transaction.js`), unknown-versus-empty states, scope and cap disclosure,
executed positive controls, and the negative-assertion ratchet with its live matcher. Stopping one
writer does not remove old databases, concurrent reads, or failures.

**FREEZE:** embedding expansion, until an actual discovery task needs it. Semantic search is not out
of scope; unmotivated expansion is.

---

## 3. Sequence

1. **Retire dead production paths, and supersede this plan's predecessor.** Local deletion of
   unreachable implementation, with every reference enumerated first and the preserved dependencies
   named. Nothing here changes an answer the product gives.
2. **Verify the supported bundle reaches the intended runtime** — parent session and subagent. Reach
   is the demonstrated problem; measure it where it fails rather than adding surface.
   ⛔ **Its first deliverable is section 3a, the definitions. Not a number.**
3. **Exercise named discovery and transitive-impact tasks against their real consumers.** Real
   tasks, real consumers, known-positive cases included so an omission can show up.
4. **Refactor the ownership seams those tasks expose** — not arbitrary equal chunks. Acquisition
   produces explicit inputs, calculation is pure, a build operation owns its transaction and staged
   state, publication has one owner. `mcp/stdio/freshness/worktree-state.js` and
   `mcp/stdio/storage/rebuild-transaction.js` already show the shape; use them rather than inventing
   a framework.
5. **Only then, consider a funded paired case series.**

**Success is a better correct answer, or less total consumer cost at acceptable quality. It is not
more invocations.** If the bundle only adds maintenance calls, stop expanding it. No new benchmark
platform and no analytics identity system.

---

## 3a. Step 2's definitions, fixed before anything is counted

⛔ **THIS SECTION EXISTS BECAUSE I ALREADY MADE THIS EXACT MISTAKE THIS SESSION.** I reported a
subagent SKILL-invocation zero as a graph-VERB figure. Both numbers were correct; the noun was not.
A reach measurement is more exposed to that failure than anything else in this plan, because the two
quantities below are easy to state in one sentence and mean different things.

### The build under test

`0.9.0`, `mcp/stdio/server.js`, launched over stdio and distributed **per repository** by an
.mcp.json file in that repo (this one is `./.mcp.json`) — not installed in user scope. **A
measurement names the exact commit it ran against**, because "the server" is a moving target and a
figure that outlives its build is a figure with no subject.

### Two runtimes, and they do not share a tool surface

A **parent session** and a **subagent sidechain** are different populations with different tool
surfaces, and `scripts/measure-verb-adoption.mjs` already reports them separately with the noun
spelled out on the sidechain figure. Its discipline is the model; the summaries built on top of it
are where the noun got lost.

### AVAILABILITY — can the verb be invoked here at all

A property of the **runtime**, not of any agent's judgement. Three states, distinguished by what the
host actually sends and accepts:

| | state | what decides it |
|---|---|---|
| A0 | not installed | no .mcp.json in the repo; no verb exists to call |
| A1 | installed, **not listed** | the verb is absent from the `tools/list` the host sends, and reaching it needs an extra step (a tool search) that the agent must think to take |
| A2 | installed and listed | the verb is in the default listing |

⚠ **A1 IS NOT A ROUNDING ERROR, IT IS THE LIKELY SHAPE OF THE PROBLEM.** In this very session the
`mcp__aify-project-graph__*` verbs arrived deferred behind a search step rather than listed. One
host, one session, observed rather than assumed — not a rate, and stated here as the reason A1 needs
its own row rather than as a finding.

### ⛔ A FOURTH STATE, FOUND BY DOING: REACHABLE, BUT NOT THE BUILD YOU THINK

A0/A1/A2 all ask whether the verb can be *invoked*. They all pass while the answer comes from
different code.

**Observed 2026-09-08, first call of the step-3 exercise.** `graph_health` reported the server
process had loaded `cf78545a` on 2026-09-06 while the checkout was `b40e132a` — **23 executable
files under `mcp/` different**, including `mcp/stdio/query/graph-capabilities.mjs`, whose absence gate had been
rewritten hours earlier. The verb was listed, callable, and answered promptly, from two-day-old code.

⇒ **THE INSTALLED BUNDLE IS NOT THE CHECKED-OUT BUNDLE, AND ONLY THE SERVER CAN SEE THE DIFFERENCE.**
This is why §3a opens by requiring a measurement to name the commit it ran against: here the server's
commit and the repository's commit were both knowable and **not equal**, and every answer would have
been attributed to the wrong one.

⚠ **AND THE DATA WAS CURRENT WHILE THE CODE WAS NOT** — the index was at `b40e132a` with
`stale: false`. Two different staleness questions share one word. A graph fact could be right while
the disclosure wrapped around it came from a build that no longer exists.

⭐ The server DETECTED and DISCLOSED this itself, unprompted and first. That guard is doing the job
this whole plan is about, and it is the reason the exercise stopped instead of publishing a figure
about the wrong build.

⛔ **CLEARING IT IS NOT AVAILABLE TO ME.** The process must be restarted by the host (an operator
`/mcp reconnect` or a CLI relaunch); reloading files or re-running the verb does not do it, and a
session restart may cycle the agent worker without respawning the MCP child. Verify by the process
start timestamp, never by the commit — an unsuccessful restart and a restart onto the same commit
look identical by commit alone.

### VOLUNTARY USE — did an agent choose it with alternatives to hand

A property of the **decision**, and it is only defined where three things hold together:
1. the verb was reachable (A2, or A1 plus a search that actually succeeded);
2. a non-graph route to the same answer existed — grep, read, the file itself;
3. the agent picked the verb anyway.

⛔ **THE DENOMINATOR IS TASKS WHERE EITHER ROUTE WOULD HAVE ANSWERED, NOT SESSIONS.** Counting
sessions puts every task the verbs do not serve into the denominator and reports self-routing as
failure. `docs/2026-08-25-seven-verbs-carrier-and-population.md` already carries the caveats that
survive here — a call is not a benefit, one machine is not a rate, usage is not value — and its
numbers are not restated.

### What must never be fused

**A0 and A1 are both "zero calls" and only one of them is about the product.** Nothing was installed
versus installed-but-unreachable have different fixes: one is distribution, the other is surfacing.
And **neither is evidence about voluntary use**, because an agent that could not reach a verb never
made a choice to observe.

### The boundary this measurement may not cross

The gated adoption re-measurement is a **separate, protected cohort**. Step 2 observes the tool
surface of a runtime; it does not read that cohort's outcome and does not accelerate it. Reading
`n` is allowed; reading the result is not.

### Measured, server side

Run 2026-09-08 against this build: the server lists **16** verbs by default and **32** under
`--toolset=full`. So half the surface is unlisted by the server's own choice, before any host
decides what to defer. That is the A2/hidden split and it is the server's half of availability.

⚠ **IT IS NOT THE HALF THAT MATTERS MOST.** A1 — the host deferring MCP tools behind a search — is a
decision the server neither makes nor can observe, and it applies to verbs the server *did* list.

### Not yet observed, and named rather than implied

The subagent-side figure needs a probe that runs **inside a subagent** and reports what its toolset
contained. That probe has not been run against `0.9.0`: an unrun measurement, not an unknown
quantity, and until it runs there is no subagent reach claim in either direction.

⭐ **AND THE OBJECTION I ASSUMED WOULD BLOCK IT IS REFUTED.** I expected such a probe to accelerate
the gated adoption cohort, since that cohort counts subagent sidechains and a probe would create
some. It cannot: `scripts/lib/adoption-window.mjs` fixes `excludeProject:
'C--Docker-aify-project-graph'` in the **preregistered** window, so sidechains spawned from this repo
are excluded mechanically — and `excludeInstructed` excludes a prompt that names the tool anyway,
deliberately over-broad because over-exclusion can only lower a measured rate. The preregistration
anticipated this exact hazard in its own words: *"the probes I spawn to verify a routing fix call
the graph because I told them to; counting them measures my own prompt."*

⇒ A blocker I was about to write down did not survive being checked. What remains between here and
that figure is ordinary work with its own decision to make, not a conflict with the gate.

---

## 3b. Step 3's tasks and acceptance conditions, fixed before anything runs

Same discipline as 3a and for the same reason: **a condition written after a result gets fitted to
it.** These are the questions the product exists to answer, so a task that grep answers just as well
is not evidence for us either way.

### The task shape that counts

A task qualifies only if it is **composed** — the answer needs several facts joined, which is the
thing grep structurally cannot do for an agent. Three families, each with a real consumer:

| family | the question | why grep cannot compose it |
|---|---|---|
| **discovery** | "where is the code that does X" when X is a concept, not a token | the caller does not know the name to search for; that is the whole problem |
| **transitive impact** | "what breaks if I change this" beyond one hop | each hop is a separate search, and the agent must hold and join the results |
| **contract joins** | "which task/feature/document governs this symbol" | the link lives across layers, not in any one file's text |

### What has to be fixed BEFORE a run

1. The exact repository and **commit**, so the graph and the ground truth describe one state.
2. The literal task text, and the consumer that receives the answer.
3. `must` / `must_not` for each task — what a correct answer contains, and what it may not claim.
4. **Known-positive cases included and marked**, so an omission can surface. A suite of tasks the
   system happens to answer measures nothing; the point is to give it chances to be caught missing.
5. Who grades, and against what — fixed before any answer exists.

### Acceptance

**A better correct answer, or less total consumer cost at acceptable quality.** Not more
invocations. If the verb is called and the answer is no better, that is a cost with no benefit and
the honest reading is to stop expanding the bundle.

⛔ **AND A CALL IS NOT A BENEFIT.** `graph_health` is the most-called verb on this machine and it is
maintenance. Counting invocations as success would score the tool highest exactly where it is doing
housekeeping.

⚠ **PREREGISTER THE ABANDON RULE.** What result would say the family is not worth pursuing — and
say it before the result exists. Without one, every outcome reads as encouragement.

### Boundaries

Outside the protected adoption cohort. No new benchmark platform, no analytics identity system, and
no paid arm until `docs/efficacy-eval-design.md`'s eight appendix items are filled — that hold is
engineering, not budget, and funding cannot lift it.

### Status: STARTED, then STOPPED at the first call, on purpose

Ground truth for three composed tasks was established by hand **before** any verb ran — that
ordering is the point, so an expectation cannot be fitted to an output.

⚠ **AND BUILDING THAT GROUND TRUTH IMMEDIATELY PRODUCED A WRONG ZERO OF ITS OWN.** The
contract-join task's truth was gathered with a case-sensitive grep that missed
`docs/known-limitations.md`, which documents the withdrawal under `WITHDRAWN`. Graded against that
truth, a correct answer would have been marked a false positive. **The ground truth needs its own
positive and negative controls, exactly like the instrument it judges** — added to the pre-run list
above in spirit, and worth stating plainly: the oracle is an instrument too.

The first attempt stopped at `graph_health`, which reported the stale-build state in §3a. Steven
restarted the process; the replacement reports `startedAt 2026-09-08T09:40:48Z`, `commit e9f1a070`,
`staleProcess: false` — **verified by start timestamp, not commit**, because a failed restart and a
restart onto the same code are indistinguishable by commit alone.

### RESULT, graded against the abandon rule fixed before the run

**T1 — transitive impact on `retainedDigest`: 4/4, no false positives.** The set equals the grep
truth exactly. What it added is not an extra item but a TYPE: `tests_adjacent_basis` marks three
edges `CALLS` and one `DEFINES`, separating the definition site from its consumers, and the answer
carries `exhaustive: false` plus a coverage caveat naming the 73-of-627-file spine.

**T2 — discovery: NO RESULT, and this is the finding.** Semantic mode fell back to lexical because
**there are no embeddings**: `APG_EMBED_ENDPOINT` unset, and zero embedding tables in the database,
confirmed against a control that could see 15 tables and 7,326 node rows. So the one family that is
the whole product thesis — find the concept whose NAME YOU DO NOT KNOW — **is not installed on this
repository.**
⇒ §2 freezes embedding expansion "until an actual discovery task needs it". **One just did.** That
condition is now met by a task that could not be answered, not by an argument.
⭐ The refusal itself was exemplary: it named the mechanism (documents match filename, title and
headings only), refused to let its own zero read as absence, and said to fall back to grep.

**T3 — contract join: 2/2 recall, poor precision, and NO precision signal.** Both governing
documents came back — but ranked 6th and 8th of 11, below three false positives
(`docs/2026-08-26-f6-withdrawn-twice.md`, `docs/efficacy-eval-design.md`,
`docs/evidence/m5-scale/PROPOSAL-decision-rubric.md`) which contain the word "withdrawn" and **zero**
mentions of this withdrawal, verified by grep. An agent taking the top three gets the wrong answer,
and nothing in the response says the list is mostly noise.

### The verdict, and what it is NOT

⛔ **NOT ABANDONED, BUT ONLY ON THE SECOND LIMB.** The rule required BOTH "no true item grep missed"
AND "no disclosure that changes what I would do". The first limb HELD — across all three tasks the
graph surfaced **no true item the grep truth missed**. What saved it is the second: the relation
typing in T1 and the refusal in T2 do change what a caller does next.

⇒ **On this run the product's value was entirely in its REFUSALS AND ITS TYPING, not in finding
anything grep could not.** That is a narrower claim than "composed questions beat grep", and it is
the one the evidence supports.

⚠ **WHAT THIS CANNOT SUPPORT: n=3, one repository, graded by the author of the change.** It is a
smoke test of composed questions, not efficacy evidence, and it must never be quoted as the latter.

⇒ **NEXT, and it is now motivated rather than speculative:** unfreeze embeddings far enough to make
T2 answerable, then re-run all three. Document ranking needs a precision signal before T3's answer
is safe to act on.

---

## 4. The structural bar, measured

Across 211 JS/MJS/HTML files under `mcp/`: **38 exceed 400 physical lines, 8 exceed 1,000.** These
are physical lines including comments, not executable statements or effort.

⭐ **AND COUNTING THE OTHER NOUN CHANGES WHAT THE DECISION SHOULD BE.** Measured 2026-09-08 over the
207 JS/MJS files: **20 exceed 400 lines of CODE, and ZERO exceed 1,000.** `mcp/stdio/query/verbs/health.js` is
2,071 physical against 908 code; `mcp/stdio/freshness/orchestrator.js` is 1,356 against 717. More than half of
the worst files is the record of *why they are the way they are*.

⇒ "Eight files are past the refactor threshold" and "no file holds a thousand lines of code" are the
same corpus under two nouns, and only one of them should drive a refactor. The size problem is real
— 908 code lines is still far past the 400 bar — but it is **half the size the physical count
implies**, and a budget on physical lines would have paid an author to delete the evidence comments
this repository runs on. The caveat was already written above; the figure that makes it actionable
was not, until now.

**A door now holds the line** (`tests/unit/source-files-do-not-grow.test.js`): files over 400 lines
of code may only DECREASE from 20, and 1,000 is a hard ceiling with no grandfathered offender. Its
counter carries its own controls, because a counter that returned zero would report an empty
violation list and get greener as the code got worse.

The worst entry point is `ensureFresh` in `mcp/stdio/freshness/orchestrator.js`, which owns cache
decisions, Git observations, rebuild selection, extraction, compiler-evidence salvage, transactions
and publication in one function whose correctness depends on distant locals and ordering. The
largest file is `mcp/stdio/query/verbs/health.js` at 2,070 lines, mixing observation, diagnosis and
report assembly.

Also: retire historical incident essays from active function bodies, keeping one invariant and a
pointer to the evidence. Preserve the history; stop making every reader pay the narrative.

⚠ Sixteen-plus targeted review findings do not estimate a whole-repo defect rate. They do establish
that GREEN is not a semantic warranty.

---

## 5. Delegation — the rule, corrected

Something goes to Steven when it **spends money**, is **irreversible**, **leaves this machine to
other people**, or **changes the approved product scope or the measurement contract**. The fourth
clause is new and it was the gap.

There is also a local operational boundary that reversibility does not cover: **cycling or killing
another agent's MCP children discards live work and needs that owner's authority**, even though the
code change is reversible. Running embeddings against a cloud endpoint
(`mcp/stdio/intelligence/embeddings.js`) is an external-data boundary; writing the optional adapter
is not crossing it.

**Not Steven's:** ordinary refactors, local deletion of unused implementation, clearer claims,
fixing test selection, and respecting an experiment gate that already exists.

⛔ **The 12 A/B runs are not merely a spend decision.** `docs/efficacy-eval-design.md` carries a
NO-RUN hold with eight unfilled appendix items. That is an engineering hold and it is mine. Funding
cannot lift it, and an invalid pilot must not be sent to him as though money were its only missing
input.

**Open and his:** whether structural history is ever recommissioned, and whether the 3D view is
cut. The second removes functioning user-facing behaviour; that is what makes it his.

⚠ **Retiring the dormant digest machinery is NOT on that list, and my first draft had it there.**
The argument for escalating was that deletion would make recommissioning more expensive. It does
not: the retained implementation has no attribution path and still uses the identity scheme the
withdrawal rejected, so keeping it compiled preserves an option it does not actually hold. Git
preserves the implementation, and the refusal API, the stored rows and table compatibility remain
either way. Retention's saving on a future implementation is unestablished, exactly as deletion's
saving is unmeasured. The scope decision was already made and ruled; removing the dead code of an
already-withdrawn feature is cleanup, and cleanup is mine.
