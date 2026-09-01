# M1a step B — resolved lexical scope: preregistration

Written **before** implementation. Step A (shipped, `07343ef`) made every extracted occurrence
survive as its own row. It did **not** make two same-named symbols distinguishable: that is B.

## The defect, located rather than inferred

`visit(node, owner, parentClass, depth, ancestors)` carries **only** `parentClass`, and
`generic.js:548` advances it on exactly one condition:

```js
nextParentClass = resolvedType === 'Class' ? activeNode : parentClass;
```

A `namespace_definition` *does* match a rule (`cpp.js:539`, emitted as `Module`), so the namespace
exists as a node — it simply never enters the scope chain, because only `Class` advances it.

**Measured consequence:** `alpha::W::go` and `beta::W::go` produce byte-identical qnames
(`src.x.W.go` for both declarations, `W.go` for both definitions). The only thing distinguishing
them lives in a `Module` node the qname never consults.

## Why the cheap option is rejected

Feeding namespaces through the existing `parent_class` channel is a one-line change and is
**semantically unsafe**. `generic.js:404`:

```js
const resolvedType = explicitType === 'Function' && parentClassLabel ? 'Method' : explicitType;
```

⇒ Every free function inside a namespace would become a **Method**. `parent_class` is also consumed
by containment edges, fingerprints and test detection. The small diff buys its size by putting a
wrong noun in a field consumers already trust — the failure mode retracted repeatedly this session.

## Design

A **separate lexical-scope context** carried by `visit`, **opt-in per language** via an explicit
config hook for `namespace_definition`. `parent_class` and class containment are untouched. Qname
composition consumes the scope; a sibling field records it with provenance so step C can tell
extracted lexical scope from guessed scope.

⛔ **COMPOSITION, NOT FALLBACK.** `generic.js:390` reads
`symbolInfo?.parentClassQname ?? parentClass?.extra?.qname ?? parentClassLabel` — **`symbolInfo`
wins**. For `namespace alpha { void Widget::render() {} }` the C++ extractor returns
`parentClassQname: 'Widget'`, so a lexical scope inserted *after* the `??` chain **would never
fire**, and gate 5 below would silently fail. Verified in source, not assumed.

## Acceptance gates

1. **All non-C++ qnames byte-identical** — not only JS/TS. Also pin `parent_class`, node type, ids
   and edges. A generic-walker *plumbing* change is allowed; a generic *behaviour* change is not.
2. A namespace **never** appears in `parent_class`, and **never** turns a free function into a
   `Method`.
3. `alpha::W::go` and `beta::W::go` are **distinct**, for both declaration **and** definition sites.
4. **Nested namespaces compose in order.**
5. **Both C++ qualification forms converge without double-prefixing**: global explicit
   `void alpha::Widget::render()` and lexical-relative `namespace alpha { void Widget::render() {} }`
   must yield the *same* scoped qname.
6. **Namespace-free C++ qnames remain byte-identical.**
7. **Site IDs are preserved.** B changes semantic scope metadata and qname; it must not move any
   occurrence *address*. `codeSymbolSiteId` takes no qname input, so this should hold by
   construction — asserted anyway, because "should hold by construction" is exactly what an
   assertion is for.

## Controls

- **positive** — a namespaced C++ symbol gains its scope; asserted on the real value, not a literal
  retyped into the fixture.
- **negative** — a namespace-free C++ symbol is unchanged (gate 6), and a JS symbol is unchanged
  (gate 1). Without these, "scope now appears" could be an unconditional prefix.
- **anti-double-prefix** — the explicit-qualification form must not become `alpha.alpha.Widget`.
- **mutant per gate** — each gate inverted and watched to fail. Gate 1 in particular: if pinning
  non-C++ qnames cannot fail, it is not protecting anything.

## Claim ceiling

"Lexical namespace scope, as written in the source, reaches the symbol's qname." **Not** resolved
semantic identity, **not** linkage, **not** a claim that two sites are the same symbol — those are
step C, under a stated equivalence authority.

## Explicitly out of scope

⛔ **Label normalisation.** Explicit qualification yields `label: "Widget::render"` while the
lexical form yields `label: "render"` — a real inconsistency, recorded as a **separate contract**.
It is adjacent to this work and is *not* folded in: B's claim is resolved lexical scope, not
canonical display labels, and bundling them would make one gate's failure ambiguous between two
changes.

⚠ **Two claim populations, kept apart** — an earlier draft said "this repo cannot demonstrate B",
which collapsed them into one dismissal and was too broad in the pessimistic direction.

- **Mechanism — CAN be qualified here.** The committed hostile fixture is frozen, has ground truth,
  and exercises every gate. It can show the mechanism works and can kill the observed failures.
- **Field prevalence and scale utility — CANNOT.** This repo's natural C/C++ production population
  is 22 of 795 `Module` nodes and **38 cpp-language symbols in total**. A green suite here says
  nothing about how often the shape occurs in real C++, or whether resolving it helps at scale.

⇒ B may claim a qualified mechanism. It may not claim prevalence. That gap goes to M5, which must
state its own prevalence noun.
