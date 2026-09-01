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

The usage observation stands (3 verbs reached). The DENOMINATOR does not: it is registry-usage, not
"3 of 43 billed affordances".

✅ **M0a HAS SINCE PRODUCED THE RECEIPT, so this gate is CLOSED** — and it did not go the way the
worry expected. The host's deferred-tool search injected **exactly** the `default` listing, same 16
names. The real per-session bill is `tools/list` **plus** an `instructions` payload that is
identical under every profile and, at `lean`, larger than the listing itself. A standing-tax claim
is now measurable; what it must be measured against is that pair, not the registry.

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

### M0a — Actual surface receipts  ✅ DONE  `docs/evidence/surface-receipts/`

Taken from the live protocol, not a module read: a spawned server, a real `initialize`, a real
`tools/list`, per profile. lean 6 / default 16 / code-intel 11 / full 32; registry **43 registered,
0 absent, 0 inconclusive at the carrier**, so "gating is listing only" is proven rather than
asserted. Controls (negative, positive, differential) all PASS, and callability is probed with an
argument the sensitive-path gate refuses so no handler ever runs.

Two numbers changed. `instructions` is **13,880 bytes on every profile** — it does not vary with
the toolset, and at `lean` it is larger than the entire tools/list. And "80% is schema" was too
high: 69.7% default, 70.6% full, 58.0% lean.

Host-side receipt (n=1, manual, kept distinct from the protocol carrier): this Claude Code
session's deferred index held the same 16 names as the `default` listing. The **8 verbs unlisted
under every profile including `full`** are callable at the protocol and unreachable in a runtime
that defers tools behind a search step.

Dead hypothesis, recorded dead: the instructions advertise **0** verbs that are not registered.
Open candidate for M4, not acted on: 4 of the default-16 (`graph_census`, `graph_dashboard`,
`graph_trace`, `graph_explore`, 5,239 of 25,539 bytes) are never named in the routing text.

### M0b — Identity qualification  ✅ DONE — THE CARRIER FAILED  `docs/evidence/identity-qualification/`

⛔ **M1 ASSUMED THE GRAPH OWNS CANONICAL IDENTITY. IT DOES NOT, AND THE MEASUREMENT IS WORSE THAN
THE OBJECTION.** Three arms, claims separated: synthetic mechanism (frozen ground truth, scale
claim zero), large non-C++ scale, and a bounded 22-file natural-C++ observation that is explicitly
**not** a prevalence estimate.

Arm 1, 16 ground-truth symbols, all controls PASS: **MATCHED 10 · FORKED 2 · ABSORBED_DISCLOSED 1
· ABSENT_FROM_GRAPH 3**, `linkage` modelled nowhere.

- **A declaration and its definition get two different keys** — and the shipped comment in
  `buildAmbiguousMatchMessage` claims the opposite. The implementation-side key carries no
  namespace and no file, so the same asymmetry causes the fork *and* a cross-namespace collision.
- **Two classes sharing a leaf name in different namespaces: the second is deleted**, and nothing
  records it. `extra.overloads` only fires when signatures differ — identical signatures are
  exactly the collision case, so the disclosure is blind where it is needed.
- Mechanism **measured, not assumed**: renaming only the second class takes the corpus from 14 to
  17 nodes. Identity collision, not a parser gap.

Arm 2 (this APG snapshot): the machinery behaves — sub-ms latency, ambiguity fires correctly — but
the **50-row retrieval cap is unreachable** here (busiest name has 37 definitions), so it stays
unqualified. Arm 3: 69 decl/def key asymmetries across 22 real files, same shape as arm 1.

**⇒ M1a is identity REPAIR, not richer rendering. No prevalence claim for C++ exists; that gap is
carried into M5, which must state its own prevalence noun.**

### M1a — Identity REPAIR, then the typed contract  `[re-aimed by M0b]`

> "Never key the answer on the name. Key it on resolved symbol identity. Return N distinct symbols
> named X, each with its own caller list, tagged with language, linkage and canonical name. A flat
> list of name matches is a grep with extra latency."

This is the one thing grep structurally cannot do, and we half-do it today: `graph_callers` refuses
an ambiguous bare name (good) but the refusal is a dead end rather than an answer.

#### Step A — occurrence/site identity  ✅ SHIPPED `29fc344`  (accepted by review; integration `f3ed77b`)

One id per extracted occurrence, from the declarator's byte span in a normalised repo-relative
path. Decl and def stay two rows; two overloads stay two rows; the colliding `beta::Widget` is a
row of its own. `site_kind` travels as a typed sibling field, never an id input — hashing a
classification would remint a site whenever the classification improved.

Measured on the rebuilt live graph: both `expand` sites now exist, and `graph_callers('expand')`
returns all four call relationships marked `prov=AMBIGUOUS`. **A false-SPECIFIC answer became a
true-but-AMBIGUOUS one** — no edge is attributed to a specific wrong site.

⚠ Scored as RETENTION + DENIAL only. The External placeholder those calls land on is
**name-collapsed unresolved attribution**, not a positive binding, and it is not counted as one.

⚠ An undeclared duplicate site is REFUSED (`APG_DUPLICATE_SYMBOL_SITE`), and the type survives to
`graph_health` — the first version recorded duplicates in an array with zero readers while
extraction fell through to the old merge branch.

#### Steps B, C, D — still open

- **B, resolved scope.** Measured, not assumed: lexical `namespace` blocks never reach a qname, so
  `alpha::W::go` and `beta::W::go` are byte-identical today. Entry criterion: after B they differ.
- **C, proven equivalence + linkage.** The only authority permitted to merge two sites.
- **D, `query/semantic identity grouping`** — ⚠ NOT a renderer concern. `canonicalSymbolKey` gates
  whether seven verbs refuse or proceed, so it is decision control flow. Measured on the fixture it
  groups **by file**: `measure` (one symbol) fires a false refusal, `clamp` (two overloads) fires
  none, `render` fires correctly but groups `.cpp` vs `.h` rather than the two namespaces.
  Fail-closed rule: distinct sites stay distinct groups until C supplies equivalence. Blast radius
  measured at 11 newly-ambiguous labels repo-wide, so it is not a warning wall.
- **Ship (after repair):** ambiguity returns the qualified candidates WITH their caller sets.
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
- ✅ **LANDED (status corrected 2026-09-01) — `index.zeroFilesProcessed`.** In the tree at `mcp/stdio/code-intel/zero-files-reason.js`, wired into `collect_code_intel.js`, covered by three test files, nothing unpushed. The previous "IN FLIGHT, UNVERIFIED, NOT PUSHED" status was stale.** The collect path could
  return `status:'partial'` having collected nothing with no field saying why, so the integration
  test asserted `expected 0 to be greater than 0`: **the test and the product shared one ambiguous
  failure string**, and a starved clangd was indistinguishable from a broken graph join. The field
  now names the mechanism, emitted **only** when `filesProcessed` is the integer 0, derived **only**
  from typed producer notes — never from scalars. Three of my first values were struck for scalar
  inference (`filesTotal===0` is this call's *remainder*; `resumedFrom` is a count, not a completion
  claim; `indexReady===false` is a state, not a cause).
- ⛔ **C++ `ALREADY_COMPLETE` IS DELIBERATELY UNREACHABLE.** Its witness is `verifiedEdges>0 &&
  intelRecords>0` over **global** counts, so one unrelated edge would license a ledger claiming
  hundreds of other files. Per-file binding cannot rescue it: **612 of 640 record-bearing files
  carry zero `LSP_VERIFIED` edges**, so requiring an edge per claimed file is fail-closed *and inert
  for 96% of the population*. A converged C++ resume now returns `partial` / `complete:false` /
  no note ⇒ `ZERO_FILES_CAUSE_UNKNOWN`. **UNKNOWN with the right object beats a reassuring value
  with the wrong one.**
- ⚠ **This fixes REPORTING, not the ledger's skip decision** — separate open defect:
  `docs/evidence/typed-zero-reason/OPEN-DEFECT-ledger-witness-is-global.md`. The 2026-08-20 Sand
  Castle class is **not** operationally closed.
- **Stop when:** every absence-shaped answer carries a scope statement an agent can act on.

### M3 — Freshness that maintains itself  `[Steven's explicit ask]`

The machinery exists but is opt-in and partial.

- **M3a:** ⏸ **HOLD — default-on is neither recommended nor refused, because it is unmeasured in
  the state that matters.** Evidence: `docs/evidence/auto-sync-cost/FINDING.md`.
  > The watcher and the post-commit hook use a **shared implementation with demonstrated expensive
  > behaviour under post-commit input** (median 35.2 s, 91% ≥ 15 s over 482 events). The watcher's
  > trigger frequency, its dirty-state cost, the `ensureFresh` paths it selects, and its
  > sustained-rerun behaviour are all **unmeasured**. Default-on remains HELD pending matched
  > dirty-edit-burst measurements.

  ⚠ The trigger changes the **input state**, not only the frequency: the hook runs with HEAD moved
  and a clean tree; the watcher runs with HEAD unchanged and bytes dirty mid-edit. Coalescing bounds
  **queue depth to one**, not duty cycle. ⛔ That evidence file preserves four retracted
  formulations of my own, each marked inline — do not quote them.
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
M0a actual runtime/profile surface receipts   | DONE
M0b no-agent scale/identity qualification     | DONE — carrier FAILED
M1a identity contract
M1b bounded per-identity answers
M2  action/absence contracts
M3  freshness/reconfirmation
M4  wider-task surface experiment
M5  expensive scale A/B
```

Not "M5 first" in the expensive sense. It is: prove the substrate and the measurement population
before adding another identity layer on top of a heuristic one.
