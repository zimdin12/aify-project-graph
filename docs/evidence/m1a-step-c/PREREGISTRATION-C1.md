# M1a step C1 — explicit equivalence authority: PREREGISTRATION

Written **before** implementation. Everything below is fixed in advance: population, identity rule,
finding schema, claim ceiling, controls, and the abandon rule.

## The defect C1 exists to fix

A C++ class-internal **declaration** and its out-of-line **definition** are one symbol split across
two sites. Extraction gives them different qnames — the declaration is module-prefixed, the
definition is not:

```
src.w.alpha.Widget.render     (declaration, in the header)
alpha.Widget.render           (definition, out of line)
```

`canonicalSymbolKey` groups by normalized qname, so they form **two groups**, and
`buildAmbiguousMatchMessage` reports a **false ambiguity** for a symbol that has none. Measured in
both pre-B and post-B arms; step B neither caused nor fixed it.

`tests/unit/query/class-qualified-lookup.test.js:114` claims to guard this. It cannot: it builds
both rows with the **same hand-written qname**, which is precisely the condition real extraction
violates. A fixture-authority defect, not a missing test.

## ⛔ What C1 must NOT do

**The acceptance predicate is not "the qnames became equal".** Making the declaration's qname match
the definition's would satisfy every symptom test and would be step B's mechanism doing step C's
job — a name-based merge wearing an identity claim. It would also silently merge anything else
whose names happen to coincide.

The predicate is: **two retained site rows are linked to one semantic symbol by an explicit
equivalence authority, and query grouping consumes that authority.**

Sites are retained. Nothing is deleted or rewritten to agree.

## Three populations, never conflated

Reporting one number across these would hide exactly the failure C1 is meant to prevent: a pair
being *proposed* is not a pair being *consumed*, and this project has repeatedly shipped a carrier
no consumer read. Every claim below names which population it is about, **before** the claim.

**P1 — extracted sites.** Every `Method`/`Function` node from tracked C++ sources plus the frozen
fixtures `tests/fixtures/identity-{hostile,nested,callers}`, derived from the language config,
never listed. Exact membership recorded; this is the denominator.

**P2 — proposed equivalence pairs.** Pairs `(site_a, site_b, authority)` the equivalence model
asserts. Every site in P1 not covered by an authority appears with a typed `UNKNOWN`, so P2
accounts for **all** of P1 rather than only the pairs it liked. A site missing from P2 is a defect
in the model, not an absence of equivalence.

**P3 — semantic groups actually consumed by query code.** The groups `canonicalSymbolKey` /
`buildAmbiguousMatchMessage` really render, read back from the shipped verb. **P2 ⊆ P3 is not
assumed and must be measured**: an authority the query layer does not consume is an unreachable
carrier, which is the shape this project keeps rediscovering, and C1 does not close on P2 alone.

## Identity rule

An equivalence relation `same_symbol(site_a, site_b, authority)` where `authority` is a typed enum
and **absence of authority is not equivalence**. Candidate authority for C1 only:

- `cpp_decl_def_same_owner` — same enclosing class qname *and* same terminal name *and* same
  parameter arity, one site a declaration and one a definition.

Anything not covered emits `UNKNOWN` and stays **separate**. Fail closed.

## Finding schema

Per pair: `{ site_a, site_b, relation: 'same_symbol' | 'UNKNOWN', authority, evidence }`.
Per query: which authority a rendered group consumed, so a reader can tell a merged group from a
coincidentally-equal one.

## Controls, fixed now

⚠ **The load-bearing negative control: absence of evidence must never become equivalence.**
Every row below states which population it constrains.

| Control | Population | Must |
|---|---|---|
| decl/def, one namespace, header+impl | P2 and P3 | merge into ONE group, authority `cpp_decl_def_same_owner`, **and the shipped verb stops reporting ambiguity** |
| alpha/beta twins (`identity-callers`) | P2 and P3 | stay SEPARATE in both |
| overloads — same name, different arity | P2 and P3 | stay SEPARATE in both |
| `UNKNOWN` authority | P2 | never merges — the key negative control |
| **coverage** | P1 vs P2 | every site in P1 appears in P2 exactly once, with an authority or a typed `UNKNOWN`. Stops the model reporting only the pairs it liked |
| **positive control on the zero** | P2 | at least one pair carries a real authority, so "no bad merges" cannot pass by proposing nothing |
| nested namespaces (`identity-nested`) | P2 | `outer::inner` distinct from `inner::outer` |

## Mutants, fixed now — each must be killed

1. **Delete the authority relation** → the false ambiguity must return **even if the qnames match**.
   (Kills a fix that secretly works by name.)
2. **Group by qname alone** → must fail on the asymmetric extracted decl/def pair.
3. **Treat `UNKNOWN` as equivalence** (the load-bearing one) → alpha/beta twins must merge, and the twin control must fail.
4. **Ignore parameter arity** → overloads must merge, and the overload control must fail.
5. **Emit the authority but do not consume it in query grouping** → P2 unchanged, P3 unchanged from
   today, and the decl/def control must fail. Kills a carrier with no reader.

## Claim ceiling

C1 claims only that decl/def sites with the stated authority are linked and that query grouping
consumes the link. It claims **nothing** about method-call edge binding (C2), nothing about caller
sets, and nothing about languages other than C++.

## Abandon-rule check, run BEFORE implementation

The abandon rule below asks whether the authority collapses into "the qnames match". **It does
not**, and this was measured rather than assumed. Available per site, all independent of the name:

| evidence | observed |
|---|---|
| `site_kind` | `declaration` in the header, `definition` out of line — a real AST property |
| `parent_class` | `Widget` on both |
| `lexical_scope` | `[alpha]` on both |
| `signature` | carries the parameter list, so **arity** is derivable |

Two results that decide the design:

1. **Overloads share both label AND qname.** `render()`, `render(int)` and `render(int, float)`
   all extract to qname `src.w.alpha.Widget.render`. Name evidence of any kind cannot separate
   them; only arity can. So the authority does real work beyond names — it is not name equality
   with extra steps.
2. **Signature TEXT must not be compared; arity must.** A declaration and its definition legally
   differ in parameter names and default arguments:
   `render(int n, float scale = 1.0f)` vs `Widget::render(int count, float scale)`.
   The raw signatures share almost nothing; both parse to arity 2. An authority comparing
   signature strings would fail on ordinary C++, and would have looked correct on a fixture where
   the names happened to match.

## Abandon rule, preregistered

If the authority cannot be computed from extracted evidence without reintroducing a name-equality
test — i.e. if `cpp_decl_def_same_owner` collapses into "the qnames match" — **stop and report
that**, rather than shipping a rule that launders name equality as identity. Say so plainly; do not
weaken the controls to make it pass.
