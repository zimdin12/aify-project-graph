# Candidate — `tt-a1i/archify`, and what is actually worth borrowing

**Logged:** 2026-09-02, at Steven's request. **Status: NOT STARTED, and deliberately so.**

⚠ **I have not inspected the repository.** This is a read of its description — "agent skill for
beautiful, verifiable architecture, workflow, sequence, data-flow and lifecycle diagrams: self-
contained HTML with motion and crisp export" — not a review. Every judgement below is provisional
until someone opens it.

## The purpose test, applied honestly

A rendered HTML diagram with motion and crisp export is **for a human to look at**. That is the same
test that failed `graph_dashboard` last cycle — *"an interactive browser UI for a human, in a product
whose stated users are agents"* (`docs/evidence/surface-receipts/FINDING-never-named-is-not-unrouted.md`).
Borrowing the output format would be building the thing our own purpose statement rejects.

So: **the artifact is not our product.** Two things inside it might be.

## 1. Skill packaging — aimed at our worst measured weakness

Our weakest half is exactly the one the purpose statement names second: *"the skills that teach an
agent when to reach for which."* Measured: 17 skills installed, **9 invocations ever**, 12 never
invoked, **0 from 1,059 subagent transcripts**. Entry-point reach works; **mid-task reach is the
bottleneck**.

If archify has genuinely solved "an agent reaches for this at the right moment", that is worth
studying **regardless of what it draws**. That is a question about skill design, not diagrams.

## 2. Diagram-as-TEXT as a denser orientation carrier — the one that could be product

`graph_packet` orients an agent in **prose**. A structured spec — mermaid, say — is **text an agent
can read**, and may be a more accurate and more token-efficient carrier for "how does this fit
together" than a paragraph.

That is not the human-facing half of archify; it is the intermediate representation. It is testable
with the rubric we already have (`scripts/lib/ab-rubric.mjs`), and it is plausibly something grep
structurally cannot produce.

⚠ Untested hypothesis. It would need its own preregistration, and a population/identity rule for
"more accurate orientation" that I cannot state yet.

## Why it is not started

The plan's own ordering: *"prove the substrate and the measurement population before adding another
identity layer on top of a heuristic one."* M5 — the milestone that tells us whether any of this beats
grep — is **blocked on the 72-run budget**, and the stop condition is live.

Starting a new capability while the core value proposition is unvalidated is precisely the failure
the stop condition exists to prevent. **Decide the budget first.**

## What would change this

- Steven says to look at it now — then it displaces M5 work, not runs alongside it.
- Or M5 runs, and the answer shapes whether orientation carriers are where the remaining value is.
  If M5 concludes our value is "orientation and structure only", item 2 above becomes considerably
  more interesting, not less.
