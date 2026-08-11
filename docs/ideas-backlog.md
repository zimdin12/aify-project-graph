# Ideas backlog — with assessment, not just capture

Ideas from Steven, 2026-08-11, recorded with my read of **whether and when** each fits.
He asked me to file them for after current priorities, and said "you decide" if any fit
the plan already. One does. One should wait, and the reason it should wait is a principle
this project has paid to learn.

Standing plan: `docs/2026-08-10-one-plan.md`. §1 (why competent agents do not reach for
the tool) outranks everything in it.

---

## ★★ IDEA 1 — `ask_graph`: one entry tool, backed by a subagent

> *"Maybe we should have really good graph skills also… and subagent configs so that we
> could have an `ask_graph` kind of action, where an agent can just ask the graph and it
> spawns a small subagent to look and use the graph and return an answer. We should test
> it also deeply — is it actually useful."*

## ⚠ CORRECTED 2026-08-11 — I read this as ROUTING. It is a CAPABILITY.

My first assessment framed `ask_graph` as an adoption fix: one entry tool, less choice
friction, §1. Steven corrected it:

> *"I was thinking more of `ask_graph` as something that would ADD FUNCTIONALITY… it
> shouldn't 'solve' the context issue, it is just displaced context usage. It can do more
> complex answering based on all the data the graph / data system has (also the agent can
> check inside the file)."*

**Both halves of that matter and the second one is sharper than what I wrote.**

★ **He is not claiming a token win, and he is right not to.** I filed "total tokens likely
go UP" as a risk to be resolved. It is not a risk — it is a known, accepted cost.
A subagent moves context off the caller; it does not remove it. Selling that as a context
fix would be the same mislabelling as calling a stale field clean.

★★ **And the value proposition changes completely.** The question is no longer *"will
agents reach for it"* but:

> **Can it answer a question that no single verb answers, and that chaining verbs by hand
> answers worse?**

"What breaks if I change the voxel material ID to 16 bits" requires the code graph AND the
overlay AND open tasks AND docs AND **reading actual file contents** — plus judgement about
which of those matter. No verb does that. Today an agent must run
`graph_consequences` → read files → `code_intel_references` → `graph_pull` → synthesise,
and carry every intermediate payload while doing it.

⇒ **That is a synthesis capability, and it is testable in a way adoption is not.** The
comparison is `ask_graph` versus a competent agent chaining verbs manually on the same
question — and the D1′ dependence method already measures exactly that: enumerate the
load-bearing claims in each answer, then ask whether either produced one the other could
not support. Answer quality, not usage counts.

⚠ **The §1 argument below still holds as a SIDE EFFECT, not as the case for building it.**
Keep the two separate: if `ask_graph` ships and adoption rises, that is the assisted-
adoption arm and says nothing about preference. The capability claim stands or falls on
answer quality alone.

---

**Assessment (original, on the routing framing): it targets §1**, which is the
highest-ranked open problem in the plan and the one nothing else currently addresses.

### Why it fits the evidence we already have

- **B2**: two managers with a working, trusted graph did not reach for it.
- **D1′**: the cold lane spent **34 consecutive calls** on grep and reads without touching
  a graph verb — while the injected instructions *named* `code_intel_references` for
  exactly the task it was doing. Discoverability was not the problem; it knew.
- **graph-senior-dev's reference reading** found the same shape everywhere:
  - CodeGraph: **one listed tool** (`codegraph_explore`) returning source + call paths in
    one call, plus a prompt hook that injects context on symbol hits.
  - Understory: injects a compact topic seed because, in its own source, *without a signal
    the model never thinks to query memory*.
  - Graphify: an opt-in strict mode that **blocks the first raw read**.
  - agent-code-intel: wins by **narrow triggers and one uniform action surface**.

⇒ The transferable shape is **one obvious entry tool**. `ask_graph` is exactly that: the
caller asks a question instead of choosing among 17 verbs and reading an evidence contract.

### ⚠ The trap, and it is the same one that contaminated D1′

**Every reference project solves adoption by FORCING or NUDGING**, and graph-senior-dev
flagged it explicitly: *"Do not use their adoption as B2 evidence — after injection, use is
compliance/availability, not preference."*

So if we ship `ask_graph` and usage rises, that tells us nothing about value unless the
design separates the arms **in advance**:

- **ASSISTED-ADOPTION arm** — routing, hooks, one-entry tool. Measures whether reach
  improves when we remove choice friction.
- **SPONTANEOUS-CHOICE arm** — no injected guidance. Measures preference.
- These must never be reported as one number. §1's whole point is that we cannot currently
  tell them apart.

### ⚠ The token trade, which is NOT obviously favourable

A subagent absorbs the full payload — evidence contract, provenance labels, the lot — and
returns a distilled answer. So:

- **caller context**: much cheaper, and stays clean. Good.
- **total tokens**: likely HIGHER, because the subagent pays full price plus its own
  reasoning.

That may still be right — Steven's goal names *"better at their work AND/OR fewer tokens"* —
but it is a trade to make deliberately, not to discover afterwards. And it interacts with
what we just measured: a 1,051-token `graph_consequences` payload is a lot for a caller and
nothing for a dedicated subagent.

★ **It also sidesteps the mixed-decision-surface problem** both reviewers identified: a
subagent can read a payload that mixes orientation, absence claims and deletion warnings,
and answer the ONE question asked. That is a real argument in its favour and it is
independent of adoption.

### ⇒ IDEA 1b — subagents for SCANNING AND FILLING the graph

> *"Scanning and filling some parts of the project could be a subagent with a skill or
> something."*

A different thing from `ask_graph`, and further along than it looks: `/graph-build-
functionality`, `/graph-build-intelligence` and `/graph-build-tasks` are already
LLM-authoring steps done by skills. Making them subagents is mostly a packaging change.

★ **But it lands on an open wound.** The overlay those skills author is exactly what Part 1
cannot justify — four fields unanswered, nothing licensed. **Automating the production of a
layer we cannot show anyone reads would scale the unvalidated investment**, and cheap
authoring makes the "is it worth it" question harder to ask, not easier.

⇒ So: **the filling half waits on Part 1**, same as the memory layer, and for the same
reason. The SCANNING half — extraction, indexing, collection — is not overlay work and does
not wait; that is the `graph_collect_code_intel` path and it already has an exhaustiveness
contract.

### Prerequisites before building

1. §1's counterfactual: ask both managers what they *anticipated* at the moment they chose
   grep. Cheap, and it may show routing is not the binding constraint.
2. Decide the arms in writing first (above).
3. Skills audit — Steven's *"really good graph skills"* half. Skills are the **conditional**
   surface (free until invoked) versus `tools/list` which bills every session. If routing
   guidance belongs anywhere, it belongs there.

---

## IDEA 2 — a memory layer in the graph

> *"We should add a memory layer, so agents could add memories to the graph, connected with
> files, maybe vector search… mapped-files layer, functionality layer, memories layer, each
> connecting to the others. A second brain for agents."*

**Assessment: WAIT — and the reason is a principle this project has already paid for.**

### The principle

**We have not yet shown the SECOND layer earns its place.** Part 1 (the overlay deletion
audit) is blocked with **four of six fields unanswered and nothing licensed**, because
neither manager can produce evidence that `features_touching`,
`contracts_potentially_affected` or `open_tasks_on_those_features` ever changed a decision.

⇒ Adding a THIRD layer before validating the second repeats the exact pattern the plan
exists to correct: build, then discover nobody reads it, then be unable to delete it
because there is no telemetry. That is the eleven-hidden-verbs story, one layer up.

### What would change my mind, specifically

- Part 1 resolves in the overlay's favour — the commit-replay experiment finds a
  load-bearing overlay claim. Then a curated layer demonstrably pays and a second one is
  a reasonable bet.
- **Or** the memory layer is scoped to the thing that DID demonstrably pay: D1′'s single
  load-bearing dependence was a **contract document reachable only through a
  symbol→contract edge**. graph-senior-dev's correction is the key: *"content was
  knowledge; selection was map."* A memory layer that is **symbol-anchored** —
  memories reachable from code, the way contracts are — is a much better bet than a
  free-floating memory store with similarity search.

### Design notes worth keeping for when it happens

- **Layers differ in kind, and the plan already has language for it.** The code map is
  `observed`; the overlay is `inferred`; memories would be `asserted` — a third provenance
  class, not a third copy of the second. `field_provenance` already carries this
  distinction and it is the field ef-manager rates highest.
- **Vector/similarity search has no exhaustiveness contract.** Everything this release
  fixed was about absence being legible. A similarity search cannot say "these are all of
  them", so it must never answer an absence question, and its results must be labelled a
  different provenance class from graph edges.
- **Reference material exists** — Understory is a knowledge-memory product rather than a
  code map: contradiction discipline, graph health, query-path replay persisted separately
  from the response. Worth a proper read before designing anything.

---

## Steven's standing constraint on all of it

> *"Skills, subagents, tools all have to be good and logically mapped — not too many, not
> too little. Architecture should be good."*

⇒ Recorded as a gate: **no new surface without a decision it changes.** That is the same
rule Part 1 applies to fields, applied to tools and skills — and the eleven hidden verbs
are what it costs to skip it.
