# Two shape detectors — preregistration

Written BEFORE implementation. Review's rule: a warning has a lower claim ceiling than an
exhaustiveness assertion, but it does **not** get a population-free pass.

## The contract both detectors emit

```
OBSERVED:   a syntactic candidate exists in population P
RISK:       this shape may make header/include-graph routing incomplete
ACTION:     inspect compiler/TU/source evidence before an absence-dependent decision
NON-CLAIMS: not a proven call edge, not a proven build member, not exhaustive,
            not proof that the graph missed anything
```

⛔ **Forbidden output: "this defeats every include-graph query."** It overclaims both mechanism
and route. An include graph may model `.cpp` includes; a repeated declaration may be harmless,
or outside the active build.

---

## Detector 1 — `candidate_extern_without_header`

⛔ **TEXTUAL CANDIDATE ONLY.** I described this as "grep-level" while claiming a declaration
*pairs with a definition* and that *no header declares it*. Pairing is semantic; a text match
cannot establish it. Review caught the slide and it is not repeated here: this detector reports
a **spelling coincidence**, never a resolved binding. Upgrading to a pairing claim requires
parser/compiler identity and is a separate slice.

**File population.** Git-tracked files only, at the indexed commit. Implementation extensions
`.c .cc .cpp .cxx .c++`; header extensions `.h .hh .hpp .hxx .h++ .inc`. Ignored dirs come from
`loadEffectiveIgnoredDirs` — the same derived exclusion the sweep and collector use, never a
third opinion. Vendored/generated trees are excluded by that rule, not by a new list.

**Lexical population.** Line-oriented scan of raw bytes. Comments, string literals, and inactive
`#if` branches **are scanned** and are therefore **candidate sources, not filtered out** — the
detector cannot tell them apart, and pretending otherwise would be the semantic claim it is
avoiding. This is disclosed in the finding rather than hidden. Line continuations are NOT
joined; a declaration split across lines is a known miss.

**Identity rule.** The bare identifier spelling only. Case-sensitive, no Unicode normalisation.
Namespaces, overloads, templates, operators, `extern "C"`, and aliases are **not** resolved —
two different symbols sharing a spelling produce one candidate, and that is a known
false-positive class, disclosed.

**Trigger.** All three must hold:
1. an `extern`-prefixed declaration of spelling S appears in implementation file A
2. spelling S appears in at least one OTHER implementation file B
3. spelling S appears in NO file in the enumerated header population

**Finding schema.** `{ detector, spelling, declaredIn, alsoIn[], headersScanned, observed, risk,
action, nonClaims[] }`. **Dedupe key:** `detector + spelling + declaredIn`.

**Claim ceiling.** "A candidate exists." Never "there is a caller", never "the graph missed it".

**Controls (all required to pass before shipping).**
- positive: a real repeated-`extern` across two `.cpp` with no header → fires
- predicted failure: the same spelling in a `//` comment → still fires, and the finding says
  comments are in the population
- predicted failure: the spelling inside a string literal → same
- predicted failure: inside an inactive `#if 0` branch → same
- negative: a symbol declared in a header → does NOT fire
- negative: `static` / anonymous-namespace symbol with no `extern` → does NOT fire
- negative: `extern "C"` block form → documented as a known miss, asserted as such

---

## Detector 2 — `implementation_file_textually_included`

Review: this one can be stronger cheaply by recognising an actual preprocessor directive rather
than a substring.

**File population.** Same as detector 1's implementation + header set, git-tracked, at the
indexed commit, same ignore rule.

**Lexical population.** A real `#include` directive: optional leading whitespace, `#`, optional
whitespace, `include`, then `"..."` or `<...>`. Substring occurrences of `.cpp` in prose or
strings do **not** trigger.

⚠ **CORRECTED AGAINST MEASURED BEHAVIOUR.** This originally said commented directives *do*
trigger. They do not — the pattern anchors on `^\s*#`, so a leading `//` prevents the match. The
implementation is more precise than this spec was, and the spec is corrected rather than left
describing a detector nobody built. Block-comment state is NOT tracked, so a directive inside a
`/* */` span on its own line still fires: a documented boundary, asserted in the tests.
Conditional (`#if`) directives DO trigger, and the finding discloses that the condition was not
evaluated.

**Trigger.** An `#include` directive whose target has an implementation extension.

**Output.** "implementation file is textually included; the build may use unity/jumbo
translation units, so per-file compilation and include assumptions may not match the build."

**Finding schema.** `{ detector, includedFile, includedFrom, line, directiveForm, conditional,
observed, risk, action, nonClaims[] }`. **Dedupe key:** `detector + includedFrom + includedFile`.

**Claim ceiling.** "A textual include of an implementation file exists." Never "this is a unity
build", never "the TU boundary is X" — the build system is not consulted.

**Controls (all required).**
- positive: real `#include "weights.cpp"` → fires
- negative: `// #include "weights.cpp"` → does NOT fire (corrected against measured behaviour;
  the spec originally predicted it would)
- known boundary: a directive inside a `/* */` span, on its own line → DOES fire, because
  block-comment state is not tracked; asserted so it is documented rather than discovered
- conditional: `#if USE_UNITY` around the directive → fires, and discloses the condition was
  not evaluated
- predicted failure: macro-generated or line-continued include → documented known miss
- negative: `#include "normalize.h"` → does NOT fire
- negative: the word `.cpp` in prose → does NOT fire

---

## Consumer route

Findings attach to existing warning surfaces only. They do NOT alter `exhaustive`, `ready`,
`cause`, or any caller set. A detector that changed an authority field would be making the
semantic claim both detectors are explicitly barred from making.
