# The goal

Steven's, in his words, recorded here so it stops being re-derived from memory. Everything else
in `docs/` is downstream of this page. If a plan does not serve something below, it is not a
plan, it is an activity.

---

## The end state

> "having a map that also gives you all added relations and info to each object, and that map
> has different layers (tasks, files, functionality) is going to have a value. specially if it
> is **honest, accurate and comfortable to use**."

A multi-layer map of a repository. Code is one layer. Tasks, files, functionality, docs and
history are the others, and the value is in the **edges between layers** — this decision came
from that doc, that decision built this feature, this feature lives in these files.

## The problem it exists to solve

> "my agents constantly forget where what files where. my sc-manager asked me today where the
> game design doc is. he has worked on the project for 2 months already. he has read it multiple
> times, but compactions and stuff make him forget that it even existed."

⭐ **This is a DISCOVERY problem, not a lookup problem, and the distinction decides the
roadmap.** Every published measurement putting grep at 100% on symbol localization presupposes
the agent already knows the symbol. **Grep cannot find what you do not know to search for.**
An agent's context is erased on every compaction; the repository's map is not. That asymmetry is
the product.

## The foundation

> "file mapping and stuff is really important it is kind of basis for the graph also. like
> foundation layer. it has to be accurate and super good. the more we can map automatically and
> well and honestly and keep it from getting stale the better it is."
>
> "what else can you base your knowledge on otherwise?"

Files and documents are the base layer. Everything above them inherits their accuracy. A wrong
edge at this layer is worse than a missing one, because the layers above will cite it.

## The bar

> "carry on with improving this service as much as we can **without producing specific slop or
> something that has low value**. we want this to be helpful reasonably, there is some golden
> space for it."

⚠ The instruction is not "add capability". It is **find the golden space and stay in it.** A
feature that is technically impressive and rarely load-bearing is slop by this definition. So is
a disclosure nobody acts on, and so is a verb that exists because it was easy.

## The original number, still unretired

> "when it becomes actually useful and would give us gains in knowledge and token usage — make
> our agents better at their work and/or consume less tokens."

⛔ The number that judged it: sc-manager, asked to name one time a graph verb changed what they
did, said **zero** — and then tested and retracted their own excuse. That has never been beaten.

---

## What the evidence says about how to get there

Measured, cited in `docs/2026-08-19-does-this-earn-its-keep.md`. These are constraints on the
roadmap, not opinions to be re-argued.

- **Do not compete on symbol lookup.** Grep is at 100%. Graph and LSP arms cost +6% to +118%
  more tokens there, and a graph condition loses to plain BM25 on keyword-findable tasks.
- **The advantage is PRECISION, not recall.** Reference precision 1.00 versus grep's 0.76, while
  recall stays ~0.66 across every arm. ⛔ Precision and exhaustiveness are orthogonal — never let
  one become the other.
- **The ceiling on localization is low.** Perfect localization buys ~3 points of downstream
  repair; perfect exploration ~9. The case rests on **not taking confidently wrong destructive
  actions**, which is a safety argument, not a throughput one.
- **Adoption is the largest measured failure mode.** 58% of trials in one study made zero tool
  calls; 64.6% of sessions in production telemetry never invoked a query tool. Agents self-route
  by task class and route *correctly*. Tool descriptions and skills are worth more measured
  points than index quality.
  - ⭐ **REFINED BY OUR OWN MEASUREMENT, 2026-08-25** (`docs/2026-08-25-adoption-is-an-install-problem.md`).
    Across every transcript on this machine: **80% of sessions invoked a graph verb where the
    server is installed** (8 of 10, three repos), and **0% where it is not** (0 of 12, six repos —
    the server is distributed per-repository via a local `.mcp.json` and is not in user scope).
    The self-routing-away finding **does not replicate here**: where agents can reach these verbs,
    they reach for them hard. Adoption is an **install** problem for parent sessions. The
    descriptions-and-skills lever is real, but it belongs to **subagents** — 7 of 1049 sidechain
    transcripts, 0.7%.
    ⚠ One machine, 22 sessions; install and task class are confounded; and a call is not a
    benefit — `graph_health` is the top verb and that is maintenance.
    ⛔ **AND THE "ZERO" ABOVE WAS COLLECTED BY ASKING AN AGENT TO REMEMBER.** Asked from recall,
    sc-manager answered NONE and then counted their own transcript: **55 invocations**. Wrong by
    two orders of magnitude, in the direction that condemns the tool. The zero is not refuted —
    its *provenance* is inadmissible. Re-derive it from transcripts, never from memory.
- **Attestation is nearly, but no longer entirely, unclaimed.** LSP, SCIP, LSIF and MCP have no
  field for index coverage. A 39.6k-star competitor now ships a coverage tool and explicitly
  disclaims completeness with it.

## What honesty has cost and bought, so far

On 2026-08-19 the claim the product rested on — `evidence.exhaustive === true` — was falsified
three separate ways against real clangd and is now **withheld entirely**. The flag never could
certify "no callers"; that path always returned `definition_only`. See
`memory/exhaustive-p0-2026-08-19.md`.

⇒ **Capability has been roughly flat since v0.4. Honesty has improved enormously.** Most of this
month removed false claims rather than adding features. That is real progress against "honest,
accurate", and it does not look like progress on a feature list. Say so plainly rather than
dressing it up.

## The measured state of the foundation layer, 2026-08-19

⚠ **MY FIRST WRITE-UP OF THIS SAID "76% WRONG EDGES". BOTH HALVES WERE WRONG**, and both agents
corrected it independently. The honest statement is below.

**MEASURED, reproduced by `graph-senior-dev` and `ef-manager` on separate reads:** ~2,370 doc→code
`MENTIONS` edges over 73 documents on APG, of which **83.5% have an all-lowercase-word target** —
`files` (60), `file` (58), `repo` (56), `tests` (53), `read` (52).

⛔ **"Lowercase-word target" is a TRIAGE PROXY, not a correctness label.** A document can genuinely
refer to `read` or `query`. The measured claim is *"83.5% of edges were admitted by a rule that
required no reference evidence"* — which is a statement about the **admission rule**, not about
each edge. Publishing it as "83.5% wrong" would be the cap-as-total defect in our own diagnosis.
What IS established from source: `mentions.js` admits every regex word collision, takes the first
node when a label is ambiguous, and records line 0.

⭐ **AND ONE REPO COULD NOT SHOW THE REAL SHAPE.** `ef-manager` ran the same census on echoes:
**63.1%**, twenty points apart, same extractor. The rate tracks the **language's naming
convention** — JavaScript names functions `exists`, `count`, `list`, `read`, so the namespace
collides with English head-on; C++ leans CamelCase and `WorldBuffer` survives contact with prose.
⇒ Any fix built on a global threshold or a hand-tuned stop-word list is right on one repo and
wrong on the other. It has to be derived per-repo from the extracted namespace.

⭐ **AND THE RANKING IS INVERTED.** On APG the noisiest term carries 60 edges; the genuinely
doc-referenced code — `ensureFresh` (9), `openDb` (7), `clampToBudget` (5), `renderCompact` (4) —
carries the fewest. **Frequency and value are inversely correlated in this relation.** Anything
that surfaces "most-mentioned symbols" is a noise generator, and anything that truncates a
mentions list by count drops the signal first.

⇒ The layer Steven names as the foundation rests on an admission rule that requires no evidence.
⚠ And `ef-manager`'s scope on it, which is the more useful fact: *"it cannot have cost me, because
I never consumed it"* — in days of intensive field use, the doc layer has had **zero consumers**.

---

## ⚠ A correction to our own record, found while writing this page

The refactor was recorded as complete and it was not. Commit `067e3ad`, titled **"TARGET MET"**,
claimed the target *"no file over ~710 lines"*. At that exact commit **fourteen files exceeded
it**, including `packet.js` at 1295.

The two files the refactor set out to split really were split, and still hold: `server.js`
1395 → 749, `brief/generator.js` 1966 → 631. **The scoped result was promoted to a global
claim** — in the commit message, and then in the session memory, where it sat for a week
telling future sessions *"the refactor is DONE. Do not re-audit."*

⇒ Same defect as everything else this month: a claim whose scope is narrower than the sentence
carrying it. It is recorded here rather than quietly fixed, because the memory that repeated it
is the one a future session will trust. `packet.js` is now **1453** — larger than `server.js`
was before the refactor began.
