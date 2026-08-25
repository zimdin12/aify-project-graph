# Variable extraction (R2) — PARKED, with the design intact

**Status: PARKED 2026-08-19, not rejected.** Reviewed and conditionally approved by
`the reviewer`; the decision not to build it now is a **priority** call by
`this project`, not a disagreement with their correctness analysis.

This document exists because of the one-plan's rule: *deaths, with reasons, so they are not
re-proposed*. The tool-split question was re-litigated twice because the reasoning lived in
a thread rather than a document.

---

## The gap, stated correctly

Tree-sitter has **no rule that emits a `Variable` node**. The only producer is the
code-intel LSP importer (`ingest/code-intel/schema.js` maps `variable`/`field`), so a repo
without a collection has none.

**⚠ The narrower wording is the true one.** My first framing was "module-level constants are
not indexed", and `the reviewer` refuted it: a const bound **directly** to an arrow or
function expression *does* become a `Function` via `arrowFnSymbolInfo`. That is exactly the
5 of 89 that resolve. The claim is **non-function module-level const bindings**. The 89 are
**two populations** — callable constants hit, value constants miss — and quoting them as one
hides the mechanism.

Measured, and independently reproduced by `the reviewer` on a fresh manifest:
- 89 distinct `^export const NAME =` names under `mcp/`; **84 have no non-External node**
- **30 of the 84** exist only as `External` stubs, carrying **55 incoming edges** (54
  REFERENCES, 1 CALLS)
- zero `Variable` rows in the node histogram
- ⚠ a cheap line-start census finds **410** `const` declarations under `mcp/` — the 84 are
  only the exported-simple subset. **Freeze the intended population before weighing growth.**
- ✅ good news: **zero** of the 84 collide with a declaration-type node, so today's failure is
  a clean miss, not a silently wrong answer.

---

## Why it is parked

**1. The gates are the honest price, and they are high.** See the design record below.
Nothing in it is padding; it is the cost of not shipping something that, in
`the reviewer`'s words, *"looks authoritative while either absorbing unrelated targets
or remaining invisible to the safety verbs that matter."*

**2. The payoff is unproven, and the evidence I have does not bound it.**

⚠ **CORRECTED 2026-08-19 by `the reviewer`, and the correction matters.** I first wrote
"the payoff class has no headroom". That over-extends the evidence: localization measurements
bound the **edgeless LOCATION-only slice** and nothing more. **Reference precision is a
different task class from symbol localization**, and my own new thesis says that is exactly
where a semantic layer's advantage lives — so the combined node+reference design is *not*
covered by those numbers. Record this reason as **payoff unproven / not a priority**, never as
"no headroom", or the record launders localization evidence into reference and deletion tasks.

What the evidence does say, for the location slice only. See
`docs/2026-08-19-does-this-earn-its-keep.md`. Agent symbol-localization success with plain
grep is measured at **100%**; graph/LSP arms cost **+6% to +118%** more tokens on that class;
a graph condition **loses** to plain BM25 on keyword-findable tasks (88.9% vs 100%); perfect
localization buys **~3 points** of downstream repair. R2's entire benefit is "`graph_whereis`
answers for a constant" — that class.

**3. R1 already removed the defect.** The false-shaped absence is gone: the miss names the
searched population and which of those types are empty in this graph. What remains is one
extra grep on a task grep is measured to win. **A capability gap, not a correctness defect.**

**⚠ A narrower slice was considered and rejected**, so it does not get re-proposed either:
nodes admitted to the LOCATION verbs only, quarantined from every resolver, edgeless, and
explicitly refused by callers/impact/consequences with a scoped reason. It dodges most of the
gates — but its benefit is still the LOCATE class and it still needs the classifier and the
unwrap rule. **Same low payoff, most of the cost.**

**What would un-park it:** evidence that constants are load-bearing for a RELATIONAL question
(deletion safety, blast radius) rather than a location one; or the C++ side, where the
`External`-stub backlog interacts with trust metrics.

---

## The design record — keep this, it is the expensive part

Produced by `the reviewer` and preserved verbatim in substance. If R2 is revived, start
here rather than re-deriving it.

### Admission rule (the part a same-file edge does NOT solve)

A same-file value edge is **necessary but not sufficient**. Four resolver paths still see a
`Variable` node and can absorb a cross-module target:
`resolver.js:478-484` (exact qname), `:487-493` (qname suffix), `:447-453`
(`resolveViaImportEvidence` globally-unique fallback), `:537-557` (repo-wide label/proximity).

Required:
- same-file value edge: direct `to_id`, **only after lexical binding resolution**
- cross-file: **only** when an import/export map resolves to the EXACT declaring file and the
  exact exported binding (`:434-444`). Aliases fine if that proof holds.
- unresolvable import source ⇒ leave the target unresolved. **The `:447-453` globally-unique
  fallback is NOT admissible for Variables.**
- one **central candidate-admission predicate used before EVERY return**, not a filter on the
  final label branch
- a non-function Variable must **never** satisfy `CALLS`. Unknown runtime callability stays
  **typed uncertainty**; do not convert it to "not callable".

⚠ *"Same-file" is not "lexically owned."* The shadow prune is correctness-bearing and must
cover function/arrow parameters, local `const`/`let`/`var`, block scopes, catch bindings,
imports, destructuring, nested closures, and hoisting. A distinctiveness gate reduces volume;
**it does not prove binding.** Negative control: a same-file `CONFIG` use shadowed by
`function f(CONFIG)`. Only edges surviving real scope resolution deserve `EXTRACTED`;
otherwise `INFERRED`, and absence is never exhaustive.

### Population

Approved for **all module-scope, simple-identifier const bindings, exported and private** —
the same-file edge makes export status no longer the semantic boundary. Retain
`extra.exported=true|false`. Still exclude locals, class fields, destructuring, re-export
syntax, and ambient/ambiguous runtime surfaces until each has its own binding contract.
Rollout may be export-first for attribution.
⚠ **Do not extrapolate the reference projects' edge percentages to this repo.** Freeze exact
AST populations; report nodes, DEFINES, value edges, unresolved delta, External retirement,
wrong-edge audit and rank delta per slice.
⚠ Node extraction must **not** use the uppercase/distinctiveness gate. That gate may bound
*edge* emission — but then the edge set is explicitly partial and "no references" carries **no
absence weight**.

### Classifier

**One** classify-by-value binding rule. **Do not change global fallthrough semantics** —
`generic.matchRule()` uses `rules.find` and calls that ONE rule; turning it into
"first non-null" changes precedence for every overlapping config and invites duplicate
classification. Replace `variable_declarator` in the existing Function-only rule with a single
`bindingSymbolInfo` returning Function / Class / Variable / null. Keeps mutual exclusion in one
place and makes exactly-one-node-per-binding testable.

### Transparent unwrapping (grammar executed, not assumed)

Value node types: `satisfies_expression`, `as_expression`, `type_assertion`,
`non_null_expression`, `class`, `call_expression`.

Peel **only** value-transparent syntax, bounded depth, require progress:
- `parenthesized_expression` → first/sole value child
- `as_expression`, `satisfies_expression` → first named child
- `type_assertion` → **last** named child (the first is `type_arguments`)
- `non_null_expression` → sole named child

Then: arrow/function/generator → **Function**; `class` expression → **Class** (methods owned by
it); anything else → **Variable**.
**Do NOT unwrap** `await`, sequence, conditional, arbitrary call, or property access — those
execute or select a value and are not transparent.

`memo`/`forwardRef` need a **separate provenance-gated semantic rule**, counting only when the
callee resolves to an allowlisted package export — never because a local function shares the
name. Support nesting deliberately. An unknown call initializer stays **Variable with
`callability: unknown`**, and caller/preflight must **refuse** a no-callers conclusion.

Controls: every transparent wrapper preserves Function; class expression becomes Class;
`Object.freeze({})` / `factory(fn)` / `await fn` / conditional / sequence do NOT become
Function; a local `memo` does not take the React exemption, an imported one does; a wrapped
function never also emits Variable.

### Consumer inventory (a precondition, not optional)

`Variable` is absent from `search.js:21` CODE_TYPES **and** from `find` CODE_TYPES,
`PREFLIGHT_TYPES`, `change_plan`, `consequences`, `explain_diff`, `pull` symbol/defines,
`onboard`, and `report` hub filters. If R2 landed only in whereis/lookup, **the node would
exist while every planning and safety surface still said miss** — the same gap one layer later.
Decide each **semantically**; do not share one universal list (call/type hierarchy must NOT
accept a known non-callable). Pin with a route-inventory test.

### Pass conditions for the spike

1. lexical/module admission + shadow controls green
2. Variable quarantined from every repo-global resolver path; import-to-exact-file the only
   cross-file admission
3. wrapped-callable/class controls and callable-unknown safety behaviour green
4. all consumers enumerated; search ranking measured under >200 candidates
5. every newly resolved edge has same-file lexical or exact-import-file evidence; zero
   wrong-edge substitutions; raw deltas published

---

## Independent corroboration of the central risk

Two mechanisms, one outcome, found separately:

- **`the reviewer`**: repo-global bare-name fallback lets a globally unique Variable absorb
  an unrelated module's REFERENCES/CALLS target. Today that stays unresolved — *honestly
  uncertain*. After R2 it becomes a confident edge to the wrong constant.
- **codegraph's own changelog** (reference audit): React `forwardRef`/`memo` components indexed
  as plain constants made their caller and impact queries report *"no callers found"* for
  components rendered across dozens of files — **"a dangerous false 'safe to change'"**.

⇒ **An indexed-but-unlinked constant is strictly more dangerous than today's clean miss**,
given our exhaustiveness contract.

## One fear that turned out to be unmeasured

`_js_symbols.js:8` justifies the gap: *"Plain data consts … return null → no symbol, so we
don't pollute the graph with non-functions."* **No reference project that indexes constants
reports constant-driven noise.** codegraph's measured floods came from imports (445K matches on
one identifier), nested worktrees, and accidental home-directory indexing; graphify's two real
incidents were a **scope** bug (locals inside arrow callbacks) and a **resolution** bug
(case-insensitive matching turning a shell `export PATH=` into a 266-edge god-node) — both
fixed without removing variable nodes.

⇒ The cost we cited to justify the gap **is not the cost anyone actually paid.** If R2 is
revived, that comment must be corrected or deleted rather than quoted as evidence.
