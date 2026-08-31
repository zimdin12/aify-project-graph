# Making the project graph actually good for agents — plan

## The purpose, stated so every item can be checked against it

We are building a knowledge system for AI agents (Claude Code, Hermes), not for humans. The
competition is **an agent holding grep**, which is a genuinely powerful tool we are not going to
replace. So the only defensible product is one that offers what grep structurally cannot, on a
graph accurate enough to be trusted, plus the skills that teach an agent when to reach for which.

Every item below must answer: **does this make an agent's decision better, faster, or safer than
grep alone?** If not, it does not ship.

---

## What the evidence actually says

### ⛔ The most important number: agents used 3 of 43 verbs

Across ten pilot sessions the entire reach was `code_intel_references` (6), `graph_health` (5),
`graph_callers` (4). Forty verbs went untouched.

That is not automatically a discovery failure — most were irrelevant to those two tasks. But it
sits next to a measured cost: an agent reported that **the tool-schema search and deferred-tool
dump plausibly cost more than reading the entire repository did**, and `tools/list` is billed on
every session. A 43-verb surface where 3 get used is a standing tax on every agent that connects.

**Working hypothesis, to be tested, not assumed: the surface is too large, not too small.**

### The rule both no-graph agents reached independently

> "Reach for the index when I need **leads**. Never when I need a **zero**."

That is the product thesis in one line, and it tells us where value is:
- **LEADS at scale** — where the candidate set no longer fits in a read. Below ~15-20 files an
  agent reads exhaustively and beats us; above it, grep "stops being an instrument and becomes a
  pile" (a symbol named `get` returning 3000 hits).
- **STRUCTURE grep cannot give** — the one place the graph demonstrably won in the pilot was
  `graph_callers` refusing a bare ambiguous name and forcing qualification into two symbols. Four
  cells reported it; one said it was what put it onto the split.
- **HONEST CONTRACTS** — so an agent knows when NOT to trust us. Every interview converged here.

### What is already covered, and is not worth redoing

- incremental reindex, cosmetic-skip, salvageable-file reuse: 43 references of machinery
- a file watcher and auto-sync pipeline (`APG_AUTO_SYNC=1`, opt-in)
- publication attestation, torn-graph refusal, absence authority (the closed unit)
- `no_compile_db` cause; two shape detectors wired to empty results

---

## The plan

Ordered so each milestone is defensible on its own, and cheap A/B only at milestones.

### M1 — Symbol identity, not name  `[the #1 interview ask]`

> "Never key the answer on the name. Key it on resolved symbol identity. Return N distinct symbols
> named X, each with its own caller list, tagged with language, linkage and canonical name. A flat
> list of name matches is a grep with extra latency."

This is the one thing grep structurally cannot do, and we half-do it today: `graph_callers` refuses
an ambiguous bare name (good) but the refusal is a dead end rather than an answer.

- **Ship:** ambiguity returns the qualified candidates WITH their caller sets, not just a refusal.
- **Why it matters:** on the pilot corpus the collision was the finding. An agent that got "2
  callers" without knowing they were 2 symbols would have renamed the wrong one.
- **Stop when:** a bare ambiguous name returns per-symbol answers, and a same-name-different-symbol
  fixture proves the sets do not merge.

### M2 — Contract in every result  `[converged ask]`

Every result states what it did NOT model: indirection, macros, conditional compilation,
extern-without-header, included `.cpp`, cross-language. Separate "no callers in indexed scope" from
"no callers", and name the scope: which TUs, which flags, was there a compile DB.

- Partially begun (`no_compile_db`, shape detectors on empty sets).
- **Stop when:** every absence-shaped answer carries a scope statement an agent can act on.

### M3 — Freshness that maintains itself  `[Steven's explicit ask]`

The machinery exists but is opt-in and partial.

- **M3a:** decide whether `APG_AUTO_SYNC` should default on. It is a background process, which is
  why it is opt-in; measure the cost before flipping.
- **M3b:** the `needs_reconfirm` gap. We detect anchors that BROKE; we never detect claims that
  went OUT OF DATE. A feature whose files were edited but still resolve is never flagged.
  Structural fingerprints are already stored — check granularity first, because per-file would
  produce too many false reconfirms to be useful.
- **Stop when:** an edit that changes what a feature's anchor DOES marks it for reconfirmation.

### M4 — Surface size  `[hypothesis, must be measured first]`

Test the "too large" hypothesis before acting: measure `tools/list` token cost, and which verbs are
reached across a wider task set. Then either narrow the default toolset or improve routing.

- ⚠ Do NOT narrow on this pilot's data. Two tasks cannot license retiring 40 verbs.
- **Stop when:** we know the per-session cost and the reached-verb distribution over ≥6 task shapes.

### M5 — Scale validation  `[the standing confound]`

Every result we have is from an 8-file corpus, where an agent said "the index is the thing under
test, not the instrument". We have no evidence at a size where the graph should win.

- **Ship:** the pilot harness pointed at a real repo, at the size where reading fails.
- **This is the key milestone that earns an expensive A/B.**

---

## How we work

Loop: build → review with dev → test → commit → push. Expensive A/B only at M5 and any later
milestone that claims a behavioural win. Cheap mechanical experiments (route census, mutant
contrast, determinism probes) at every milestone — they have caught more defects than anything else
in this arc, including one that rejected its own proposed fix.

**What would make us stop:** if M1 and M2 ship and an agent with the graph still cannot beat an
agent with grep on a task at M5 scale, the honest conclusion is that the graph's value is
orientation and structure only, and we should say so rather than keep building.
