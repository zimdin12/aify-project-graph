# F6, corrected — what a reader CAN and CANNOT tell apart

**This corrects a claim I had already sent to review.** I wrote that AMBIGUOUS edges are *"leads
rendered beside compiler-proven edges with nothing at the point of use distinguishing them."*
That is false, and checking it produced a narrower, sharper, and more actionable finding.

## What a reader actually receives

    fmt (C++, no collection):
      EDGE basic_cstring_view→include::fmt::os::c_str CALLS include/fmt/os.h:105 conf=0.60
      TRUST: heuristic only (tree-sitter) — resolves calls BY NAME, so a common name OVERCOUNTS
             with unrelated same-named calls, and C++ virtual/cross-TU dispatch UNDERCOUNTS

    click (Python, collected):
      EDGE write_usage→wrap_text  CALLS src/click/formatting.py:158 conf=0.95 [lsp✓]
      EDGE test_wrap_text_...     CALLS tests/test_formatting.py:487 conf=0.95
      TRUST: lsp-partial (caller set is a FLOOR, verify before any "no callers" / delete)

⇒ **`[lsp✓]` is rendered PER ROW, and the `TRUST:` line states the tier explicitly.** The verb is
honest about verified-versus-not, and the C++ warning names both failure directions — overcount by
name collision, undercount on virtual dispatch. That is good work and my earlier claim erased it.

## ⛔ The real gap: EXTRACTED and AMBIGUOUS are indistinguishable

Measured across the CALLS relation:

    fmt      EXTRACTED n=5604  conf 0.6..0.95  avg 0.611
             AMBIGUOUS n=3051  conf 0.6..0.95  avg 0.608

    click    EXTRACTED    n=2732  conf 0.95..0.95
             LSP_VERIFIED n=1410  conf 0.95..0.95
             AMBIGUOUS    n= 842  conf 0.95..0.95

Neither the `[lsp✓]` marker nor the confidence value separates them:

| distinction | can a reader tell? |
|---|---|
| LSP_VERIFIED vs unverified | ✅ yes — `[lsp✓]` per row, plus the TRUST line |
| EXTRACTED vs **AMBIGUOUS** | ⛔ **no** — identical in every rendered field |

`EXTRACTED` means a call was resolved **by name** — it may overcount, but a destination was
identified. `AMBIGUOUS` means `resolveTarget` FAILED and an External placeholder was materialised:
the source relation and site are real, the **destination identity is unbound**.

Those are different epistemic states with different remedies, and they render identically.

## ⚠ And in `click` every one of them carries `conf=0.95`

A compiler-verified edge and an edge whose destination could not be resolved both report the same
confidence. Whatever `confidence` is measuring there, it is not how much the destination can be
trusted — and `0.95` beside an unbound destination reads as near-certainty.

## What changed, and what did not

- **Withdrawn:** "nothing at the point of use distinguishes them". The per-row `[lsp✓]` and the
  TRUST banner do distinguish verified from unverified, clearly.
- **Withdrawn:** an earlier attempt to measure this per-verb. That probe counted the string
  `AMBIGUOUS`, which in verb output means **"AMBIGUOUS MATCH — the symbol name resolves to several
  candidates"** — an unrelated concept. Counting it as edge provenance was invalid and its numbers
  are void.
- **Stands:** the per-relation shares. AMBIGUOUS is 35% of CALLS in fmt, 31% in FastRoute, 28% in
  p-queue, 17% in click — against 8.4% whole-graph.
- **New and sharper:** the undistinguished pair is EXTRACTED vs AMBIGUOUS, not verified vs
  unverified. Roughly a third of C++ caller rows are edges whose destination was never bound, shown
  exactly like edges whose destination was.

## ⭐ A separate observation from the same dump

`graph_callers(symbol: "c_str")` on the **most-called symbol in fmt — 102 incoming calls** — returns
no callers at all. It returns an AMBIGUOUS MATCH prompt listing 6 same-named definitions, capped at
5, and asks for a qualified name.

The behaviour is defensible (six real declarations share that name) and the message is actionable.
But the commonest question about the commonest symbol yields zero rows on the first attempt, and
that is worth measuring properly rather than inferring from one example.
