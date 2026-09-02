# Candidate — `tt-a1i/archify`, and what is actually worth borrowing

**Logged:** 2026-09-02, at Steven's request. **Status: NOT STARTED, and deliberately so.**

✅ **INSPECTED 2026-09-02** (repo README via fetch). The description-only read below was revised
after looking; where it was wrong, the correction is marked. Steven pushed back on the first version
and was right to.

## What it actually does

- **Agents author a typed JSON IR; Archify deterministically compiles it** to HTML/SVG. The JSON
  source is kept, with named views and validation receipts. **The IR is the agent-facing artifact;
  the HTML is a view of it.** That split is the important idea.
- Five diagram kinds: architecture, workflow, sequence, data flow, lifecycle.
- **"Verifiable" means INTERNALLY consistent, not true of the code**: schema, layout, HTML/SVG,
  route and label-to-route clearance checks. Architecture nodes *may* carry author-declared `SRC n`
  evidence pinned to a commit — **author-controlled, not automatic inspection of a codebase.**
- Activation is a natural user prompt ("Use Archify to draw: Browser -> API -> Redis").

## ⛔ Two corrections to my first assessment

1. **I dismissed the artifact too quickly.** I argued "our users are agents, so a rendered diagram is
   out". That conflates the MAP with the VIEW. The mapping is knowledge; the rendering is one view.
   `graph_dashboard` exists and is used, so making its rendering good is legitimate.
2. **It is NOT a fix for our mid-task reach problem.** I had speculated it might be. Its activation
   is user-driven at the entry point — the same activation we already have working. The skill-design
   lesson I hoped for is not there.

## The purpose test, applied honestly

A rendered HTML diagram with motion and crisp export is **for a human to look at**. That is the same
test that failed `graph_dashboard` last cycle — *"an interactive browser UI for a human, in a product
whose stated users are agents"* (`docs/evidence/surface-receipts/FINDING-never-named-is-not-unrouted.md`).
Borrowing the output format would be building the thing our own purpose statement rejects.

So: **the artifact is not our product.** Two things inside it might be.

## ⭐ THE DIFFERENTIATOR THIS EXPOSES

Their diagrams are verifiable **against themselves**. Ours could be verifiable **against the code**:
we hold a symbol graph, so an architecture map whose nodes are DERIVED from real edges — and can be
re-checked when the code moves — is something they structurally cannot do and grep certainly cannot.

That also connects to M3b: **a diagram is a claim about architecture that goes out of date.** The
same "claims that went stale" gap, with a concrete artifact attached to it.

And to feature mapping: the overlay `tests/fixtures/linkage-scope/prompts.json` is not it — the
overlay this repo would use is functionality.json, which my M3b census measured as **ABSENT here**
(`docs/evidence/needs-reconfirm/FINDING-what-m3b-actually-needs.md`). There is no incumbent format
competing with a typed IR, so adopting one costs nothing in migration.

## 1. Skill packaging — REVISED: not the lesson I expected

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
