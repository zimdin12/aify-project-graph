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
