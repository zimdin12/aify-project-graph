# FINDING — M2's list, checked construct by construct. Two of its items do not hold.

M2 asks results to state what was NOT modelled, and lists: *indirection, macros, conditional
compilation, extern-without-header, included .cpp, cross-language*. I shipped a caveat naming
several of those. **The list was treated as evidence, and it is not.** Each construct is now
measured on a purpose-built fixture with a plain call as positive control.

## The table — every cell observed

| construct | heuristic (tree-sitter) | clangd |
|---|---|---|
| plain call **[CONTROL]** | edge conf=0.60 | edge conf=0.95 `[lsp✓]` |
| **extern, no header** **[CONTROL]** | edge conf=0.60 | edge conf=0.95 `[lsp✓]` |
| macro-generated call | **NO EDGE** | **NO EDGE** |
| function-pointer call | **NO EDGE** | edge conf=0.95 `[lsp✓]` |
| inactive `#ifdef` branch | edge conf=0.60 (**overcount**) | **NO EDGE** |
| `#include`d .cpp (not a TU) | edge conf=0.60 | **NO EDGE** |

⇒ **Only the MACRO case is blind in both tiers.** Everything else is tier-dependent, and the
direction is the actionable part: tree-sitter parses TEXT, so it counts calls that never compile and
cannot follow a pointer; clangd only ever sees what the compile database actually compiles.

## ⛔ Two of the milestone's own list items are WRONG for this tool

- **`extern`-without-header is fully modelled.** Both tiers resolve it. Shipping it as a caveat
  would be a FALSE caveat — telling an agent we cannot see something we demonstrably can. That
  corrodes trust in correct results exactly as badly as the reverse, and it is now asserted
  ABSENT from the clause by test.
- **"indirection" is only half true.** The heuristic tier misses a function-pointer call; clangd
  resolves it (`caller→demo::ptrTarget conf=0.95 [lsp✓]`). An earlier version of my caveat asserted
  it was unmodelled outright.

## The sequence of wrong claims, because the pattern is the point

Three versions of this one sentence shipped or nearly shipped with unobserved content:

1. *"an inactive branch is invisible to BOTH tiers"* — wrong about tree-sitter, which reports it.
2. *"calls through function pointers or std::function… NOT MODELLED"* — wrong about clangd.
3. `extern`-without-header — would have been wrong about both, and was only ever in the caveat's
   candidate list because the milestone named it.

Every one came from the same move: reasoning correctly from how a compile database works, then
writing the conclusion into product text as though it had been watched. **The reasoning was never
the problem. Publishing it as an observation was.** Each check cost about four minutes.

## What is locked, and what is not

- **Tested, no clangd required** (`m2-heuristic-misses-indirection-and-macros.test.js`,
  `m2-heuristic-counts-uncompiled-calls.test.js`): the heuristic tier misses function-pointer and
  macro calls, and reports inactive-`#ifdef` calls. These are OUR behaviour and are the negative
  claims — the dangerous kind, because an agent that believes "we cannot see X" acts on it.
- **Reproducible script, not a test** (`scripts/m2-conditional-compilation-probe.mjs`): the clangd
  column. Third-party behaviour needing an LLVM install.
- **NOT established:** prevalence. One fixture per construct, one compiler, one platform. Nothing
  here says any of these constructs is common in real C++, or that a real absence has ever been
  wrong because of one. That remains M5's question.
- **NOT covered:** `std::function` specifically (only a raw function pointer was tested), virtual
  dispatch, templates, and cross-language — the last is handled elsewhere, in the ambiguity path.

---

## Addendum 2026-09-02 — the SIXTH list item, cross-language, measured at last

When the five constructs above were checked I wrote that cross-language is *"handled elsewhere, in
the ambiguity path"*. That was an assertion from READING the code — the same move that produced
three wrong sentences in this very document. Now measured, on a fixture with `applyGain` defined in
both `src/audio.cpp` and `src/gain.glsl`:

```
UNDER TEST  applyGain   (C++ + GLSL)   ambiguous=true   crossLanguageNote=true   namesLanguages=true
  - src::gain::applyGain          src/gain.glsl:2
  - src::audio::audio::applyGain  src/audio.cpp:2
CONTROL     sameLangDup (C++ only, twice)  ambiguous=true   crossLanguageNote=FALSE
```

⛔ **The control is what makes this mean anything.** A note that fired on every ambiguity would tell
an agent nothing; it fires on the cross-language pair and stays silent on the same-language one.

⇒ **Cross-language is DISCLOSED, not unmodelled** — so like `extern`-without-header it must NOT be
added to the "NOT MODELLED" clause. Two of M2's six list items describe things this tool handles.
⇒ Already guarded by `framing-not-data.test.js` and two others, so no new test was added. The claim
was right; only the evidence for it was missing.

### A cosmetic oddity, chased to the point where it stops mattering

The C++ candidate displays as `src::audio::audio::applyGain` — module prefix `src.audio` plus
namespace `audio`, doubled. `canonicalSymbolKey` strips the module prefix; `displaySymbolCandidate`
does not, so the name shown differs from the identity resolved.

**The decision-relevant question is whether the displayed name works when an agent retries with it**,
because if it does not the refusal is a dead end — M1's exact failure. Measured, retrying with each
string exactly as printed:

```
src::gain::applyGain          -> RESOLVED
src::audio::audio::applyGain  -> RESOLVED
```

⇒ **Both resolve. No fix warranted.** Recorded so the next reader who notices the doubled segment
does not re-investigate it, and so that if the retry ever stops resolving, this is the measurement it
regressed against.

---

## Addendum — the citation defect is REPO-WIDE, and the gate is deliberately narrow

After the plan was found citing evidence by ambiguous bare name (`FINDING.md` -> 9 candidates), the
same check was run over every markdown file under `docs/`:

```
docs scanned: 206      distinct citations: 1,000
AMBIGUOUS bare names:     45   (e.g. server.js x2, laravel.js x2, tsconfig.json x13)
unresolved as written:   469   (mostly UNDER-QUALIFIED but unique; a few dead)
```

⇒ **The gate added at `tests/unit/docs/plan-citations-resolve.test.js` covers the PLAN ONLY, and
that is a decision, not an omission.** Sweeping 514 citations across 206 files was rejected:

- Most are **historical records** (`2026-08-10-one-plan.md`, `code-intel-v2-*`). Rewriting their
  pointers is churn that changes no agent's decision and destroys the record of what was written
  at the time.
- Some genuinely point at **other repositories** (`worldbuffer-authority.md`,
  `modified-this-frame.md` are echoes docs), where "unresolved here" is correct.
- `tsconfig.json` has 13 candidates because it is a generic filename — ambiguity there is inherent,
  not a defect.

⇒ The value is concentrated in the documents an agent is actually routed to: the plan (gated) and
the current evidence files. **Applying the purpose test to our own documentation**: fixing a
historical citation does not make an agent's decision better, faster or safer, so it does not ship.

⚠ Recorded so the 45 and the 469 are known numbers rather than an unmeasured mess, and so anyone
who later wants the gate widened knows the size of what they are taking on.
