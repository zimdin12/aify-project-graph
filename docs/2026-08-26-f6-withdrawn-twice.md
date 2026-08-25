# F6 — withdrawn a second time, and the pattern matters more than the finding

**Staged for commit once the running suite clears. Written now so the correction is not lost.**

## The claim, twice wrong

1. First version: *"AMBIGUOUS edges are leads rendered beside compiler-proven edges with nothing at
   the point of use distinguishing them."* → **Withdrawn.** `[lsp✓]` marks every verified row and
   the `TRUST:` banner states the tier.
2. Second version, narrowed after that correction: *"EXTRACTED vs AMBIGUOUS are IDENTICAL in every
   rendered field."* → **Also withdrawn.** Executed against a uniquely-named symbol carrying an
   AMBIGUOUS incoming edge:

        EDGE write_significand→write_significand CALLS include/fmt/format.h:2429 conf=0.60 prov=AMBIGUOUS
        EDGE write_fixed→write_significand       CALLS include/fmt/format.h:2546 conf=0.60
        EDGE to_string→to_string                 CALLS include/fmt/format.h:900  conf=0.60 prov=AMBIGUOUS
        EDGE vformat→to_string                   CALLS include/fmt/format-inl.h:1458 conf=0.60

`renderProvenanceTag` has always emitted ` prov=<P>` for anything that is neither EXTRACTED (silent,
for terseness) nor LSP_VERIFIED (`[lsp✓]`). AMBIGUOUS rows are tagged. EXTRACTED rows are not.

## ⛔ Why I got it wrong, twice, in the same direction

Both times I inferred from the **database** — the `provenance` and `confidence` columns look alike —
instead of rendering an actual AMBIGUOUS edge and reading the output. My earlier dump contained only
EXTRACTED and LSP_VERIFIED rows, so the tag never appeared, and its absence read as proof it did not
exist.

⇒ **An absence in a sample is not an absence in the system.** The first dump could not have shown
`prov=AMBIGUOUS` — no row in it had that provenance — so it was incapable of falsifying the claim I
drew from it. A probe that cannot return PRESENT cannot return ABSENT, and I applied that rule to
the product all day while breaking it on my own finding.

⚠ And the direction is consistent: twice I underestimated what the tool already does. The defects I
have been most confident about are the ones I reasoned into rather than executed.

⚠ Getting the render took two attempts of its own: the first three candidate symbols were all
blocked by the ambiguous-NAME prompt (F11), so a uniquely-named symbol was required — F11 obstructing
the measurement of F6.

## What survives

| claim | status |
|---|---|
| EXTRACTED vs AMBIGUOUS indistinguishable | ⛔ withdrawn — `prov=AMBIGUOUS` is on the row |
| AMBIGUOUS is 35% of CALLS in fmt, 31/28/17% elsewhere | ✅ stands, per-relation measurement unaffected |
| every provenance carries `conf=0.95` in click | ✅ stands — confidence carries no trust information |
| the MEANING of `prov=AMBIGUOUS` is not stated where a reader meets it | ✅ the real, small residue |

## The residue, stated precisely

A reader sees `prov=AMBIGUOUS` and can tell the row apart. Nothing at the point of use tells them
what it means: that `resolveTarget` failed and an External placeholder was materialised, so the
source relation and call site are real while the **destination identity is unbound** — a lead back
to source, not proof of the named callee.

That is a documentation gap of one clause, not a rendering defect. It is also exactly what review
scoped in the first place: *"put that meaning where `prov=AMBIGUOUS` is rendered."* Review was right
about the fix while I was wrong twice about the problem.

⇒ Remaining question for review, unchanged by any of this: is `confidence` meaningful at all, when a
compiler-verified edge and an edge with an unbound destination both report 0.95?
