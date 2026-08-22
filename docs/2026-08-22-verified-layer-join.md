# The verified layer is mostly not reachable from the verb that would use it

Measured 2026-08-22, after code-intel collection took `LSP_VERIFIED` call edges from 19 to 3,008.
Found because `ef-manager` field-tested the change on a symbol whose truth they had established
**by hand** that morning.

## The case that exposed it

`graph_callers("getChangedFilesSync")` returns **exactly the right answer** — the two callers they
had verified by hand, no third. And:

    EDGE getChangedFiles→getChangedFilesSync           git.js:69             conf=0.90
    EDGE deriveFilesFromSinceSync→getChangedFilesSync  packet-verify.js:17   conf=0.90

**Both are `provenance=EXTRACTED`.** With 2,820 verified edges in that graph, the verified layer did
not participate in the answer at all.

⇒ Their verdict, which is the right one: *"still not usable for deletion on its own. Not because it
was wrong — it was right — but because nothing in the output lets me tell that from the case where
it is wrong."*

## The measurement

    LSP_VERIFIED edges                                    2820
      targeting a `ci:lsp:` node (the parallel layer)      2100   74.5%
      targeting an extraction node                          720   25.5%

    extraction Function/Method/Class nodes                 2373
      reachable by at least one VERIFIED edge                200    8.4%

⇒ **On a randomly chosen declaration, `graph_callers` sees verified evidence 8.4% of the time.**
Collection created its own `ci:lsp:` symbol nodes and attached three quarters of the verified edges
to those. The caller verb resolves the *extraction* node, so most of the evidence is invisible to it.

## ⛔ This is the doc-layer defect again, one week later

The doc layer had "zero consumers" because `docs` was missing from `DEFAULT_LAYERS` — quality work
on something unreachable. Here I raised verified edges 19 → 3,008, reported it as a material
improvement to the trust surface, and **74% of it cannot be reached by the verb it was meant to
improve.**

⇒ The rule I wrote after the doc layer — *check reachability from the verb an agent actually calls,
with no arguments they would have to already know* — I then failed to apply to my own next change.
Writing a rule down is not applying it.

⚠ **The 19 → 3,008 figure is still true and was still worth doing.** `code_intel_references` reads
the records directly and does benefit; `deletedWithCallers` (hook rule B) queries by provenance and
does benefit. What is *not* true is the implication I let stand: that `graph_callers` answers got
better. For 91.6% of declarations they did not change at all.

## What is NOT being claimed here

⚠ **This is not a diagnosis of why the layers are separate.** `ci:lsp:` nodes may be deliberate —
they carry information extraction cannot (compiler-resolved identity across overloads). Whether the
right fix is joining them, resolving the verb through records, or something else is **not decided
by this measurement**, and I have not investigated it.

⚠ **And the −6% is unexplained.** A reindex after collection took verified edges 3,008 → 2,820 while
the 182,594 underlying records stayed intact. `ef-manager` confirms 2,820 persists. Neither of us
has chased it.

---

# CORRECTIONS — my hypothesis was wrong, and the consumer-side number is worse

## ⛔ 1. "The join is attempted and missing" — REFUTED by measurement

The importer ranks its resolution candidates, and `ci:lsp:` is explicitly labelled a **fallback**:

    (1) callable node (Method/Function) beats container/Symbol;
    (2) otherwise a real tree-sitter node beats a synthesized ci:lsp Symbol;
    (3) otherwise first-seen wins.

So I hypothesised the join was being attempted and missing 74% of the time. **It is not.** Of the
1,145 `ci:lsp:` nodes carrying a file path:

    a real node exists, same file + same label       6    0.5%
      ...and within 1 line of it                     0
    no same-file same-label extraction node       1139   99.5%

⇒ **There was nothing to join to.** The language server sees symbols tree-sitter extraction never
created nodes for. The two layers cover **different populations**, not one population joined badly.
That is a different fact with a different remedy, and "the join is broken" would have sent the next
person to fix code that is working.

## ⛔ 2. THE CONSUMER-SIDE MEASUREMENT — 0 of 27

`ef-manager`'s proposal, and the right instrument: a table-side ratio can be true while every answer
an agent actually receives is unchanged. Deterministic sample — every 47th of 1,908 distinct
declaration labels, no randomness, replayable:

    sampled                                    40
    answered with EDGE lines                   27
      carrying VERIFIED provenance              0    0.0%

**POSITIVE CONTROL, because a dead detector and a true zero are identical:** the same detector run
against six declarations that *do* carry verified inbound edges fires **6 of 6**
(`ReadOnlyWorkspaceError`, `Workspace`, `AttributionError`, `normalizeCount`, `documentEvidence`,
`shortReason` — all reporting `TRUST: lsp-partial`).

⇒ So the zero is real. **The table-side figure was 8.4%; what a caller actually receives is 0 of 27.**

## What this settles, and what it does not

⇒ **Settled:** the collection improved the evidence the database holds and did **not** improve
`graph_callers` answers for a randomly chosen declaration. The correction I owed — "19 → 3,008 is
true, the implication that caller answers improved is not" — is understated rather than overstated.

⚠ **`ef-manager` reproduced the table-side numbers exactly and explicitly refused to be cited as
corroboration**, on the rule they have been applying to me all week: *two reads of one source are
one instrument read twice; independence is a different substrate, never a second reader.* They read
the same `graph.sqlite` with different queries. That confirms the arithmetic, **not the finding**.
The consumer-side measurement above is a different substrate — it goes through the verb — and is
the one that should travel.

⚠ **Still not diagnosed:** whether the populations *should* be joined. `ci:lsp:` nodes carry
compiler-resolved identity that extraction cannot express. This measurement does not decide it.

---

# RETRACTION — "0 of 27" WAS AN INVALID RUN. THE FIGURE IS 2 OF 30, AND IT ESTABLISHES NOTHING.

`ef-manager` replayed the consumer-side measurement and got **2 of 30 (6.7%)**, not my 0 of 27. I
re-ran mine with the positive control **interleaved into the same pass** and reproduced theirs
exactly: 41 sampled, 30 answered, **2 verified (`arm`, `rowProblem`)**, in-pass control 6 of 6.

My original run landed in a REBUILD WINDOW. Both `arm` and `rowProblem` were in my sample — at
indices 2 and 32 — and I reported neither. My positive control ran *afterwards, separately*, so it
passed while the sample it was supposed to vouch for had been silently depressed. `ef-manager` hit
the identical transient twice today and caught it **only because their control ran inline**.

=> **A control that does not run in the same pass as the measurement does not vouch for it.**

## AND NEITHER RUN ESTABLISHES ANYTHING - THE STATISTICS, NOT THE POINT ESTIMATE

    mine (invalid)     0 of 27     95% interval ~[0%, 12.5%]
    both valid runs    2 of 30     95% interval ~[1.9%, 21.3%]
    table-side figure              8.4%

**Both intervals contain 8.4%.** n=30 cannot distinguish "the consumer sees nothing" from "the
consumer sees the table-side rate". ef-manager: *a point estimate of 0.0% from 27 trials is the most
quotable number in this whole thread and the least supported.*

=> **RETRACTED:** "what a caller actually receives is 0 of 27" and "my correction was UNDERSTATED".
The correction was correctly stated the first time; my attempt to strengthen it was the error.

## What survives

**19 -> 3,008 is true.** **The implication that `graph_callers` answers materially improved is still
unsupported** - consumer-side ~6.7%, table-side 8.4%, and no sample here separates either from low
single digits. The reachability lesson stands on the *table-side* 8.4% and the 99.5% non-overlap,
neither of which is in dispute.

ef-manager's point that a near-empty overlap should produce a LOW rate rather than a ZERO one was the
tell, and it was right: the overlap is 6 nodes, not 0.

## MY PROPOSED SECOND-SUBSTRATE TEST WAS TAUTOLOGICAL

I suggested replaying against a corpus where collection was never made. Where collection was never
made there are **zero verified edges by construction**, so 0-of-N cannot fail - guaranteed by the
absence of the thing being measured. A test that cannot return PRESENT cannot return ABSENT.

## THIS REPO IS A MOVING TARGET FOR ANYONE WHO DOES NOT OWN IT

Twice today a measurement against APG was silently invalidated by a rebuild window opening between
calls, once for each of us. **Any measurement taken here while the other party is working needs its
control in the same pass.**

---

# CORRECTION 3 — MY CONSUMER LIST WAS TOO SMALL, AND THE COLLECTION DOES REACH AGENTS

I wrote "only `code_intel_replay`, `collect_code_intel` and `health` read that table". `ef-manager`
swept it: the ones I missed are reached **transitively** through `mcp/stdio/code-intel/query.js`,
and they are agent-facing verbs.

    change_plan.js:398      getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) })
    packet-evidence.js:18   getCodeIntelEvidenceForSymbol(db, { qname: String(symbol) })
    pull.js:1363            getCodeIntelEvidenceForSymbol(db, { qname: String(node) })

I checked direct table reads and stopped one level short — the exact failure I was correcting in
the same message.

## Measured, with the manifest checked in-pass

Ten qnames that hold collected records, sampled deterministically from the 200 richest:

    asked explicitly (layers:["code_intel"])   found:true  10 of 10
    present WITHOUT asking (default layers)                 0 of 10

⇒ **The collection is reachable and it delivers.** A consumer that asks gets the evidence every
time. A consumer that does not ask gets nothing.

⚠ **AND THAT OPT-IN IS DEFENSIBLE HERE, UNLIKE THE DOC LAYER.** `docs` was empty for 70.5% of files,
so gating it bought nothing; `code_intel` evidence is per-symbol and genuinely expensive. This is
the same SHAPE as the doc-layer defect without being the same DEFECT, and saying so is the
difference between a rule and a reflex.

## ⇒ THE LEAD FOR THE `graph_callers` GAP, WHICH I HAD REFUSED TO GUESS AT

`ef-manager` answered the review question I have now cited twice and failed twice — *is there a
correct implementation of this in the codebase already?*

    export function getCodeIntelEvidenceForSymbol(db, { qname, symbolId } = {})

**It is symbol-keyed.** That is precisely the access pattern `graph_callers` lacks: the verb
resolves an extraction NODE, while the evidence is keyed by `qname` / `symbol_id` in the records.
Three verbs already call it.

⚠ **Still not a proposed fix** — neither of us is claiming this is the remedy. It is the place a
remedy should start, rather than at a new join between node tables.
