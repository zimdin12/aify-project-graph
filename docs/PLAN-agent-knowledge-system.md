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

#### Steps B, C, D — **status corrected 2026-09-02**

- **B, resolved scope.** ✅ **SHIPPED** (`efa3c15`, `51ef3ca`, `da61a58`; gates 1 & 7 documented in
  `docs/evidence/m1a-step-b/`). The entry criterion is met: `alpha::W::go` and `beta::W::go` are no
  longer byte-identical. Verified in git 2026-09-01 — this bullet had described the PRE-B state
  as current, and a memory index likewise still said step B was on HOLD.
- **C, proven equivalence + linkage.** The only authority permitted to merge two sites.
- **D, `query/semantic identity grouping`** — ⚠ NOT a renderer concern. `canonicalSymbolKey` gates
  whether seven verbs refuse or proceed, so it is decision control flow. Measured on the fixture it
  groups **by file**: `measure` (one symbol) fires a false refusal, `clamp` (two overloads) fires
  none, `render` fires correctly but groups `.cpp` vs `.h` rather than the two namespaces.
  Fail-closed rule: distinct sites stay distinct groups until C supplies equivalence. Blast radius
  measured at 11 newly-ambiguous labels repo-wide, so it is not a warning wall.
  - ✅ **The decl/def half is FIXED** (`6372aae`): `canonicalSymbolKey` strips a module prefix only
    for rows carrying real namespace qualification (`extra.lexical_scope`, which only C++
    declares) and only when the prefix matches the module derived from that row's own file path.
    `alpha::Widget::render` went REFUSED_AMBIGUOUS(2, selectedTargets=0) → one identity; bare
    `render` went 4 candidates → 2 genuine ones. Dropping the prefix globally was REJECTED: it
    merges JS classes that differ only by module.
  - ✅ **The OVERLOAD half is now FIXED TOO** (`2b11170`, 2026-09-02). It had returned NO_CALLERS
    with 0 candidates — no ambiguity signal at all — because `canonicalSymbolKey` groups by qname
    and overloads share one. Fixed with a second pass: a group subdivides by normalized PARAMETER
    LIST, and only when EVERY member states its parameters, so a missing signature can never fork a
    decl/def pair. The whole signature could not be used — decl and def differ by the written
    qualifier — but that divergence sits entirely BEFORE the parenthesis.
    Measured: 3 of 6,272 groups fragment (0.048%), all three inspected and correct; mechanism and
    regression controls both pass. ⛔ Splitting alone was NOT enough: the first working version
    printed two identical candidate bullets under a hint telling the agent to qualify harder, which
    no C++ program can do for an overload set. The parameter types are now in the candidate list.
    See `docs/evidence/m1b-overloads/FINDING-param-list-key.md`; the older `docs/evidence/m1b-overloads/FINDING.md` reached the
    opposite conclusion and is marked superseded in place.
- **Ship (after repair):** ambiguity returns the qualified candidates WITH their caller sets.
  ⛔ **THIS BULLET CARRIED A ✅ FOR THE WRONG CLAIM until 2026-09-02.** It read "DONE for the
  namespace case, both languages (`9860bdd` JS, `57fb7de` C++)" and cited fixtures showing
  `alpha → {alphaCaller}`, `beta → {betaCaller}`, disjoint. That is **caller sets being disjoint
  when queried ONE AT A TIME** — a different statement from *the refusal returns them*. The
  refusal listed names and locations only, so an agent still spent one call per candidate to
  learn which one it meant: the dead end this milestone is named for, marked shipped.
  ✅ **NOW ACTUALLY DONE** (`76675ef`, hardened in `a8d92a7`): each candidate is followed by its
  own caller set. Verified on this repo's real graph, not only fixtures —
  `graphDir → 4 callers: snapshotArtifacts, removeArtifacts, publishedGeneration (+1 more)` and
  a second candidate at `16 callers … (+13 more)`. Bounded as this section's own bullet requires
  (≤ limit candidates, ≤ 3 names each) so a high-cardinality name narrows instead of fanning out.
  Opt-in by db handle, and the opt-OUT is tested: five other verbs share this refusal.
  ⚠ An empty set is scoped ("0 callers in the indexed graph") under one shared FLOOR caveat; a
  bare per-candidate "0 callers" would be an absence claim stripped of its trust line.
  ⚠ Both fixtures had to be given their PROJECT CONFIG first — the JS one had no
  package.json/tsconfig.json, the C++ one no compile_commands.json, and both zeros had been
  recorded as "caller attribution is structurally unavailable".
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
  - ✅ **MET as of 2026-09-02** (`2b11170`): decl/def do NOT fork (`6372aae`) and overloads do NOT
    collapse. Both halves are asserted in ONE test file
    (`tests/integration/m1b-overloads-do-not-collapse.test.js`) precisely so neither can be traded
    for the other, and 3 consumer mutants confirm the verb fails without each part.
    ⚠ This bullet's warning had already caught a real overclaim: an earlier session closed the
    namespace fixture and reported "M1 complete" using exactly the too-weak test described above.
    ⚠ Claim ceiling: ONE hostile fixture, three files, one compiler. Says nothing about how often
    overloads are merged in real C++, and the blast radius on a C++ codebase is UNMEASURED.

### M2 — Contracts at action/absence-authorising results  `[scope corrected]`

⚠ My title said "in every result", which is a 43-verb rewrite, while my own stop condition said
absence-shaped answers. The stop condition is authoritative: structured contracts at every action
or absence-authorising result, with PROSE conditional on result shape. Recreating the warning wall
the pilot agents skimmed would undo M2's own purpose.

Such a result states what it did NOT model: indirection, macros, conditional compilation,
extern-without-header, included `.cpp`, cross-language. Separate "no callers in indexed scope" from
"no callers", and name the scope: which TUs, which flags, was there a compile DB.

⛔ **THAT SIX-ITEM LIST WAS A HYPOTHESIS, AND TWO OF ITS ITEMS ARE FALSE.** Following the sentence
above literally would ship a caveat claiming we cannot see things this tool demonstrably CAN — and a
false caveat corrodes trust in correct results exactly as badly as a missing one does. Every
construct is now measured, each on its own fixture with a plain call as positive control.
Evidence: `docs/evidence/m2-construct-coverage/FINDING-what-is-actually-unmodelled.md`.

| construct | heuristic (tree-sitter) | clangd | in the shipped clause? |
|---|---|---|---|
| plain call **[CONTROL]** | edge 0.60 | edge 0.95 `[lsp✓]` | — |
| **extern, no header** | edge 0.60 | edge 0.95 `[lsp✓]` | ⛔ **NO — fully modelled** |
| **cross-language** | disclosed by the cross-language note, and the note stays SILENT on a same-language duplicate | | ⛔ **NO — disclosed, not unmodelled** |
| macro-generated call | NO EDGE | NO EDGE | ✅ yes — the only both-tier blind spot |
| function-pointer call | NO EDGE | edge 0.95 `[lsp✓]` | ✅ yes, but as HEURISTIC-ONLY, not absolute |
| inactive `#ifdef` branch | edge 0.60 (**overcount**) | NO EDGE | ✅ yes, with the DIRECTION named |
| `#include`d .cpp (not a TU) | edge 0.60 | NO EDGE | ✅ yes, as a clangd undercount |

⇒ **Only the macro case is blind to both tiers.** Everything else is tier-dependent, and the
DIRECTION is the actionable part: tree-sitter parses text (so it counts calls that never compile and
cannot follow a pointer), while clangd only sees what the compile database actually compiles.
⚠ A mutant that ADDS the `extern` caveat is killed by the suite, so the plan and the product now
disagree in the safe direction: the code refuses the false claim even if this prose invites it.

- Partially begun (`no_compile_db`, shape detectors on empty sets).
- ✅ **LANDED (status corrected 2026-09-01) — `index.zeroFilesProcessed`.** In the tree at `mcp/stdio/code-intel/zero-files-reason.js`, wired into `mcp/stdio/query/verbs/collect_code_intel.js`, covered by three test files, nothing unpushed. The previous "IN FLIGHT, UNVERIFIED, NOT PUSHED" status was stale.** The collect path could
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

- **M3a:** ⏸ **STILL HELD, but the COST objection is now refused rather than open.** Measured
  2026-09-02 in the state that matters — HEAD unchanged, bytes dirty mid-edit — over three
  interleaved repeats: cosmetic **313 ms**, body-only **36 ms**, signature change **42 ms**, added
  call **35 ms**, noop **39 ms**, forced rebuild **75,393 ms**. Every preregistered threshold clears
  by three orders of magnitude, both controls pass, and the decision rule (fixed before the numbers
  existed) returns RECOMMEND DEFAULT ON **on burst cost**.
  Evidence: `docs/evidence/m3-freshness/{PREREGISTRATION,FINDING}-auto-sync-burst-cost.md`.
  ⇒ The 35.2 s / 91%-≥-15 s figures below describe **full rebuilds** (reproduced here at 75 s) and
  do not describe a burst. They no longer argue against default-on; they argue against confusing
  the two.
  ⛔ **The default is NOT flipped, and the four remaining blockers are not timing questions:**
  the watcher's own IDLE cost, OVERLAPPING bursts (sustained editing where one arrives mid-sync —
  the normal agent workload, and the one thing single-burst timing cannot reach), WSL/`/mnt` where
  the watcher is default-off for unrelated reasons, and a large C++ repo.
  ⚠ A doubt I raised against my own result — that the TTL fast path had served cached noops and I
  had timed a cache hit — was WRONG, and neither preregistered control could have caught it (`F`
  uses `force:true` and bypasses the cache). Settled by an EFFECT check: the edit reached the graph
  (probe nodes 0 → 1 without force, 1 forced, 0 after revert). The missing control is named in the
  finding: a timing control cannot distinguish work from a cache hit at any number of repeats.
  Superseded context: `docs/evidence/auto-sync-cost/FINDING.md`.
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
  Only review, compiler or behaviour evidence may promote a candidate to semantic drift. ⚠ **STATUS CORRECTED 2026-09-01 against the evidence file this bullet cites.** Two things here
  were stale. (1) The **52.9% figure is RETRACTED** in `docs/evidence/needs-reconfirm/GRANULARITY-FINDING.md` itself — it was a
  model-derived proxy under an unstated edit model, not an observed false rate. What actually
  disqualifies per-file is STRUCTURAL: `structural_fingerprints` is keyed on `file_path`, so one
  changed file marks every symbol anchor in it indistinguishably (mean 4.3, median 3 symbols per
  file). Decisive without any probability. (2) **Anchor-scoped hashing is NOT the remedy** this
  bullet implies: review rejected it because a hash comparison needs TWO authorities, and
  reindexing after an edit refreshes the only stored fingerprint — erasing the drift M3b exists to
  retain. "No migration" was quietly becoming "no baseline". The gap: We detect anchors that BROKE; we never detect claims that
  went OUT OF DATE. A feature whose files were edited but still resolve is never flagged.
  Structural fingerprints are already stored — check granularity first, because per-file would
  produce too many false reconfirms to be useful.

  ✅ **THE GRANULARITY GATE IS ANSWERED (2026-09-02)** —
  `docs/evidence/m3-freshness/FINDING-fingerprint-granularity-gate.md`. Re-derived from the schema
  and the graph: `structural_fingerprints` is keyed `file_path PRIMARY KEY`, 838 rows, and the
  spread is median 3 / mean 4.3 / p90 9 / max 49 symbols per file. ⚠ That **CONFIRMS the figures
  already in this bullet rather than discovering them** — re-derivation from the artifact, not a
  new result.
  ⭐ **What IS new, and it reframes M3b:** `mcp/stdio/ingest/fingerprint.js` hashes symbol shapes plus the
  outgoing ref set and **deliberately excludes bodies** — its own header says a
  body-only/comment/whitespace/literal edit leaves the hash UNCHANGED. So flipping a comparison or
  changing a constant is invisible unless it also adds or removes a call. That is how a
  *behavioural* claim goes stale, and **no granularity fixes it**: the insensitivity is to bodies,
  not to scope, so a per-symbol fingerprint would be equally blind.
  ⇒ **M3b splits.** STRUCTURAL claims (signature, callers, edges) are servable on this substrate
  today, at the false-reconfirm rate above. BEHAVIOURAL claims are not servable on it at all, and a
  finer fingerprint is not the missing piece.
  ⚠ A suspected defect was checked and NOT found: `from_id` in the ref set looked like it smuggled
  byte-span position into a position-free hash, one block below the comment explaining why `node.id`
  had been removed for exactly that reason. It is mapped through `ownerShape` to `shape#ordinal`,
  which survives comment insertions. Reported as no-defect so it is not re-suspected.
- ⛔ **DISPOSITION SUPERSEDED 2026-09-02 — "(b) is the remaining blocker" WAS WRONG.** It read: M3b
  is held behind (a) M1 identity — ✅ SHIPPED (`0a7a16d`) — and (b) a persisted per-anchor
  confirmation lineage, with **(b) NOT built and the remaining blocker**. Measuring (b)'s SUBSTRATE
  first changed the question, and building (b) would not have unblocked anything.
  Evidence: `docs/evidence/m3-freshness/FINDING-m3b-does-not-earn-its-place.md`.
  - Even with the lineage built, a reconfirm would fire at **file granularity** (mean 4.3 symbols
    per file) and would miss **behavioural** drift entirely — `mcp/stdio/ingest/fingerprint.js` excludes
    bodies by design, so a finer fingerprint does not help: the insensitivity is to BODIES, not to
    scope.
  - Against this plan's own purpose test, a signal that fires several times per real change AND
    misses the common case does not make an agent's decision better. It fails the way the 445-byte
    warning wall failed — **a caveat that fires too often trains its reader to skim, degrading the
    signals around it.**
  - ⇒ **Recommend scoping M3b to STRUCTURAL claims with the granularity stated, or dropping it.**
    NOT building a behaviour-capable substrate: that is a research project wearing a feature's
    clothes, and this plan's stop condition says to name that rather than keep building.
  - ⚠ The ~77% false-reconfirm figure is a MODEL from mean symbols-per-file, not an observed rate,
    and is labelled as such — this plan already carries one retracted model-derived proxy (52.9%).
  - ⚠ **Nobody has measured whether claims go stale often enough to matter**, which is what should
    decide between scoping and dropping. Same gap M5 exists to close.
- **Stop when — the single ~10% ceiling was SPLIT by review, and the split is right:**
  - **Carrier correctness: zero tolerance.** A prompt must never name an unchanged population as
    changed. Identity ambiguity, missing baseline, moved span or unreadable bytes become typed
    UNKNOWN, never a reconfirm.
  - **Policy usefulness: no universal ceiling.** Measure on an ADJUDICATED population —
    `unit = (confirmed anchor identity, subsequent commit)`, truth = a reviewer saying the anchored
    contract needs reconfirmation — and report TP/FP/FN/TN plus alerts per session and handling
    cost. `FP/(TP+FP) <= 10%` is a HYPOTHESIS for a non-blocking candidate, not a grounded ceiling.
  - Emit `anchor_bytes_changed_since_confirmation` / `reconfirm_candidate` — never
    `claim_out_of_date`. A fingerprint proves bytes changed; it cannot prove what the code DOES
    changed.

### M4 — Surface size  `[hypothesis, must be measured first]`

Test the "too large" hypothesis before acting: measure `tools/list` token cost, and which verbs are
reached across a wider task set. Then either narrow the default toolset or improve routing.

- ⚠ Do NOT narrow on this pilot's data. Two tasks cannot license retiring 40 verbs.
- **Stop when:** we know the per-session cost and the reached-verb distribution over ≥6 task shapes.

⛔ **THE HYPOTHESIS IS REFUTED. DO NOT NARROW.** This section described an untested hypothesis long
after it had been tested; the measurements lived only in evidence files. Recorded here so the plan
stops inviting the work.
Evidence: `docs/evidence/m4-surface-cost/{FINDING,REACH-FINDING}.md`.

- **Cost, measured over the real server** (`selectListedTools` executed, not reconstructed):
  `default` = **16 tools, 25,539 bytes, 70% SCHEMA**, 24% description. Controls in the same pass:
  POSITIVE — every profile returned a non-empty list; NEGATIVE — an unrecognised profile falls back
  to `default` with identical bytes. ⚠ Tokens are an ESTIMATE at 4 bytes/token; no tokenizer ran.
- **Reach, measured over 1,119 transcripts**: **15 of the 16 listed verbs are reached** (94%). Only
  `graph_census` never. Agents also invoke **3 UNLISTED** verbs by name (`graph_status`,
  `graph_find`, `graph_digest`) — so **listing is not what governs reach**, which is the assumption
  the whole "narrow the surface" idea rests on.
- ⇒ The original "3 of 43 verbs" framing had **two wrong nouns**: 43 is the REGISTRY (a session is
  shown 16), and it came from TWO tasks.
- ⇒ If narrowing is ever revisited, **schema is where the bytes are** — trimming descriptions
  attacks the smaller 24%.

⚠ **The ≥6-task-shape half of the stop condition is still UNMET** — transcripts are sessions, and
shape was never labelled. It is left unmet deliberately: the decision it gates (narrowing) has been
made in the conservative direction on other evidence, so measuring shapes now would be measurement
with no decision attached. It becomes required again the moment anyone proposes narrowing.
⚠ **Reach measures INVOCATION, not usefulness.** A reached verb is not a verb that helped.

### M5 — Scale validation  `[the standing confound]`

Every result we have is from an 8-file corpus, where an agent said "the index is the thing under
test, not the instrument". We have no evidence at a size where the graph should win.

- **Ship:** the pilot harness pointed at a real repo, at the size where reading fails.
- **This is the key milestone that earns an expensive A/B.**

⭐ **READ THIS BEFORE BUILDING ANYTHING FOR M5 — a decision rubric ALREADY EXISTS.**
This section named none of it, and the cost was immediate: on 2026-09-02 I proposed and began
building a decision rubric from scratch, then found the better one already in the tree and withdrew
the proposal. The plan pointed at nothing, so the work was re-done.
Evidence: `docs/evidence/m5-scale/PROPOSAL-decision-rubric.md` (records the withdrawal).

- `scripts/lib/ab-rubric.mjs` — **blind** to which arm produced a transcript; primary endpoint
  `unsafeAuthoritativeConclusion` is **three-valued** (`true`/`false`/`ambiguous`) so it cannot fail
  open; verb list derived from the real 43-tool registry, not retyped.
- `tests/fixtures/linkage-scope/ground-truth.json` — **preregistered** ground truth, 6 classes
  (internal linkage, no-header extern, unity build, header-exposed, dynamic boundary, torn graph),
  plus `successDefinition`, `knownRouteGap`, `notReachedRule`, `corpusHygiene` and a **`freezeRule`**
  that forbids redesigning toward the test.
- `tests/unit/ab/rubric-cannot-fail-open.test.js` — pins the branches that must not resolve to
  "safe", including a hedge followed by a go-ahead.

⚠ **"NOTHING CONSUMES IT" WAS TRUE WHEN WRITTEN AND IS NOW RETIRED (2026-09-02).** Measured again by
the same method (whole repo, including `await import()` forms): the rubric now has **two executing
non-test consumers** — `scripts/linkage-scope-preflight.mjs:96` and `scripts/linkage-scope-runner.mjs:21`.
`scripts/ab-runner.mjs`, the old harness, still scores with `ordered_contains`/`groups`, which measure
**retrieval, not decision**, and is not the harness for this experiment.

✅ **THE WIRING IS BUILT** (`942a246`, evidence `docs/evidence/m5-scale/FINDING-runner-wiring.md`):
preflight with four controls, per-class corpus materialisation, C6 tearing that **verifies itself and
refuses if it did not take**, exact prompt text, the unmodified rubric, and reporting per tier / class
/ runtime / arm with no cross-tier total. Four mutants killed. It runs today on a mock executor and
spends nothing.

⛔ **ONE thing is still open, and it is NOT a design question: the BUDGET** (4 repos × 3 tasks × 2 arms
× 3 repeats = 72 runs, Steven's call). No real executor ships, deliberately — writing one is the only
remaining step that could accidentally spend, and it should wait for that decision.

⛔ **THE "tier B DESIGN I COULD NOT LOCATE" WAS A FALSE BLOCKER** (retired `3691e87`). `tier` is a
per-class field in the key: tier A = purpose-built qualification (C1, C2, C3, C5), tier B = real
pinned snapshots (C4, C6). The corpus and `tests/fixtures/linkage-scope/prompts.json` were present the whole time. **I had never
opened the fixture directory.** This blocked the milestone for several cycles on an unchecked claim,
which is why a blocker now has to name the artifact it was read from.

⭐ **What the free work already narrowed, before any budget is spent**
(`docs/evidence/m5-scale/FINDING-route-census-publication-state.md`, `docs/evidence/m5-scale/FINDING-tearing-contrast.md`): on a delete decision the
graph arm **cannot** produce an authoritative "no callers" — `code_intel_references` is the verb the
product's own text routes there, `evidence.exhaustive` is never true on that path, and neither it nor
`code_intel_hierarchy` can reach publication state at all. So the honest question an A/B can settle is
whether **a floor plus a refusal** beats grep, not whether the graph out-answers grep. Worth knowing
before authorising the spend.
⚠ The key covers linkage and scope; `macro` and `ifdef` appear nowhere in it, and the measured
construct table makes the macro case the natural **known-loss control**. Per `freezeRule` that
belongs in a NEW preregistered version, never as an edit to the frozen key.

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

⚠ **STATUS COLUMN ADDED 2026-09-02.** Six of these eight rows carried NO status while their own
sections recorded closed work — the at-a-glance table contradicted every section beneath it, and it
is the part of this document a reader sees first. Re-derived from the artifacts, not from recall.

```
M0a actual runtime/profile surface receipts   | DONE
M0b no-agent scale/identity qualification     | DONE — carrier FAILED
M1a identity contract                         | DONE  (caller sets disjoint, JS + C++)
M1b bounded per-identity answers              | DONE  (overloads split; refusal carries caller sets)
M2  action/absence contracts                  | DONE  (scope + construct coverage, 5 consumers)
M3  freshness/reconfirmation                  | ANSWERED, NOT BUILT
                                              |   M3a cost objection REFUSED; default NOT flipped
                                              |   M3b dispositioned: scope to structural, or drop
M4  wider-task surface experiment             | HYPOTHESIS REFUTED — do NOT narrow
M5  expensive scale A/B                       | WIRED, green, spends nothing
                                              |   BLOCKED on ONE thing: the 72-run budget
```

⚠ **THIS ROW CARRIED AN EXPIRED BLOCKER UNTIL 2026-09-02.** It read `budget (72 runs) + a "tier B"
design`. The tier B design was never missing — `tier` is a per-class field in the key, and the
corpus and prompts were present the whole time; I had not opened the fixture directory. A summary
that names an unfixable-looking gate alongside a real one stops work for the wrong reason, so a
blocker here must now name the artifact it was read from.

⇒ **M5 moved substantially without spending anything**: preflight (4 controls, 3 mutants), a route
census over the real registry, a preregistered tearing contrast, and the runner itself — all green,
all mock-driven. What is left is the budget decision and, only after it, a real executor adapter.
The plan's own stop condition is live: M1 and M2 have shipped, so what remains is to find out whether
a graph-armed agent actually beats a grep-armed one at scale — and to say so plainly if it does not.
The free work has already narrowed *what that question can honestly be*: see M5 above on the
delete-decision route.
⚠ Every DONE above is measured on fixtures and this repo. None of it establishes prevalence in real
C++, and none of it shows a decision changed at scale. That is the single thing M5 exists to supply,
and the reason no row above should be read as evidence the product works.

Not "M5 first" in the expensive sense. It is: prove the substrate and the measurement population
before adding another identity layer on top of a heuristic one.
