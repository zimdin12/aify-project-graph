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
