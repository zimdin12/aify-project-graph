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

## 4. The structural bar, measured

Across 211 JS/MJS/HTML files under `mcp/`: **38 exceed 400 physical lines, 8 exceed 1,000.** These
are physical lines including comments, not executable statements or effort.

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
