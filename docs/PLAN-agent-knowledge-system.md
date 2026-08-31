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

### CORRECTED: "3 of 43" attached a real number to the wrong noun

I wrote that agents used 3 of 43 verbs and called a 43-verb surface a standing tax. Review executed
the profile census and it is wrong as stated:

```
registered/callable TOOLS   43
lean      tools/list         6
default   tools/list        16
code-intel tools/list       11
full      tools/list        32   (11 hidden even from full)
```

**43 is the CALLABLE registry, not the listed affordance.** The default surface is already gated to
~16, and our own source says why: "~40 verbs is fine as an EXPERT/full API but too many as the
agent's DEFAULT affordance — agents under-pick from big lists." The gating I proposed to
investigate already exists and already shipped.

The usage observation stands (3 verbs reached). The DENOMINATOR does not. It is registry-usage, not
"3 of 43 billed affordances", and it cannot carry a standing-tax claim until M0a produces a real
per-runtime receipt — the host deferred-tool search may inject a different catalogue again.

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

### M0a — Actual surface receipts  `[before any surface claim]`

Freeze, per runtime and profile: exact names the real tools/list carrier returns; schema
bytes/tokens injected at session start; the ToolSearch response population for the pilot query; the
registered-but-unlisted population; and which of those each usage count had access to.

### M0b — Identity qualification, no agents, no product code  `[blocks M1]`

⛔ **M1 ASSUMED THE GRAPH OWNS CANONICAL IDENTITY. IT DOES NOT.** Verified in symbol_lookup.js:
`canonicalSymbolKey` returns `type:qname`, so **overloads with different signatures collapse into
one key**, and the fallback `type:label:file_path` **splits a declaration from its definition**.
"Canonical" overclaims a heuristic grouping key, and attaching caller sets to those groups would
attach them to false groups.

On pinned real repos, execute current ambiguity behaviour against a hostile identity population
with frozen ground truth: overloads sharing a qname; declaration + definition of one external
symbol; repeated extern across TUs; same leaf name in different namespaces; static and
anonymous-namespace twins; templates and operators; cross-language homonyms; a high-frequency name
whose candidates exceed retrieval caps. Measure merges, forks, caller attribution, truncation,
bytes, latency.

**If the carrier is sound on that population, build M1. If not, M1 becomes identity REPAIR rather
than richer rendering of false groups.**

### M1a — Typed identity contract  `[top ask from n=3 interviews]`

> "Never key the answer on the name. Key it on resolved symbol identity. Return N distinct symbols
> named X, each with its own caller list, tagged with language, linkage and canonical name. A flat
> list of name matches is a grep with extra latency."

This is the one thing grep structurally cannot do, and we half-do it today: `graph_callers` refuses
an ambiguous bare name (good) but the refusal is a dead end rather than an answer.

- **Ship:** ambiguity returns the qualified candidates WITH their caller sets, not just a refusal.
- **Why it matters:** on the pilot corpus the collision was the finding. An agent that got "2
  callers" without knowing they were 2 symbols would have renamed the wrong one.
- `identity`: compiler-resolved ID/signature when available, else `extracted_candidate` — **never
  "canonical"**. Language, full scope, signature/overload, linkage/TU scope, decl/def relationship,
  provenance, and a typed unknown for every unestablished dimension. No cross-language merging.

### M1b — Bounded per-identity caller sets

- exact candidate total, or an explicit lower bound when retrieval is capped
- callers grouped under identity, never unioned across groups; per-group
  `{items,total,truncated,fetchCap}`
- high-cardinality names narrow rather than multiplying N x 100 edge fetches into an output wall
- **Stop when:** a hostile fixture proves overloads do NOT collapse and decl/def pairs do NOT fork.
  ⚠ My original acceptance test was too weak: a same-name-different-symbol fixture passes while a
  renderer still collapses overloads and forks decl/def.

### M2 — Contracts at action/absence-authorising results  `[scope corrected]`

⚠ My title said "in every result", which is a 43-verb rewrite, while my own stop condition said
absence-shaped answers. The stop condition is authoritative: structured contracts at every action
or absence-authorising result, with PROSE conditional on result shape. Recreating the warning wall
the pilot agents skimmed would undo M2's own purpose.

Such a result states what it did NOT model: indirection, macros, conditional compilation,
extern-without-header, included `.cpp`, cross-language. Separate "no callers in indexed scope" from
"no callers", and name the scope: which TUs, which flags, was there a compile DB.

- Partially begun (`no_compile_db`, shape detectors on empty sets).
- **Stop when:** every absence-shaped answer carries a scope statement an agent can act on.

### M3 — Freshness that maintains itself  `[Steven's explicit ask]`

The machinery exists but is opt-in and partial.

- **M3a:** decide whether `APG_AUTO_SYNC` should default on. It is a background process, which is
  why it is opt-in; measure the cost before flipping.
- **M3b:** ⚠ RENAMED `reconfirm_candidate`. "needs_reconfirm" overclaims: a structural fingerprint
  can prove an anchored span or file CHANGED; it cannot prove that what the anchor DOES changed.
  Only review, compiler or behaviour evidence may promote a candidate to semantic drift. Already
  measured (af6fc10): per-file fingerprints give a 52.9% false rate, so this needs anchor-scoped
  hashing or it does not ship. The gap: We detect anchors that BROKE; we never detect claims that
  went OUT OF DATE. A feature whose files were edited but still resolve is never flagged.
  Structural fingerprints are already stored — check granularity first, because per-file would
  produce too many false reconfirms to be useful.
- **Stop when:** an edit to an anchored span raises a `reconfirm_candidate` at under ~10% false
  rate. Above that it is an anti-signal and does not ship.

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

**What would make us stop:** if M1 and M2 ship and a graph-armed agent still cannot beat a
grep-armed agent at M5 scale, one honest conclusion is that our value is orientation and structure
only.

⚠ BUT THAT IS NOT THE ONLY CONCLUSION, and mis-attributing it would be its own defect. If the graph
loses because tool-discovery tax, stale state or false identity dominated, the cause is that
component, not the premise. Preregistered component outcomes, assigned BEFORE reading the result:
identity failure | route-not-reached | surface-cost loss | stale-evidence loss | no incremental
utility despite all preconditions met.

⚠ DENOMINATOR: "the top interview ask" rests on THREE retained interviews, not ten. Ten task
dispositions were graded; interview and cost evidence is n=3.

## Order (revised with review, agreed)

```
M0a actual runtime/profile surface receipts   | parallel
M0b no-agent scale/identity qualification     |
M1a identity contract
M1b bounded per-identity answers
M2  action/absence contracts
M3  freshness/reconfirmation
M4  wider-task surface experiment
M5  expensive scale A/B
```

Not "M5 first" in the expensive sense. It is: prove the substrate and the measurement population
before adding another identity layer on top of a heuristic one.
