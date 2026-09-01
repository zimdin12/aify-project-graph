# FINDING — the C++ decl/def pair cannot share a canonical key, by construction

Status: **asserted**. Mechanism read in source; both halves measured on the shipped path.

## Why this blocks M1

M1 requires `graph_callers` to return qualified candidates WITH their caller sets. Measured live
on `d5597ac` via `scripts/step-b-caller-isolation.mjs`, every query still refuses:

```
alpha::Widget::render   disposition=REFUSED_AMBIGUOUS  renderedCallers=[]  selectedTargets=0
beta::Widget::render    disposition=REFUSED_AMBIGUOUS  renderedCallers=[]  selectedTargets=0
render                  disposition=REFUSED_AMBIGUOUS  renderedCallers=[]  selectedTargets=0
```

Fully qualified, `alpha::Widget::render` still returns two candidates:

```
- alpha::Widget::render                 src/widgets.cpp:4    (definition)
- src::widgets::alpha::Widget::render   src/widgets.h:8      (declaration)
```

These are one C++ entity. **No target is ever selected, so no caller set can be rendered even if
edge attribution were perfect.** This gates M1 ahead of the edge-layer defect.

## What is stored (probe over the shipped indexer, not the extractor in isolation)

| row | qname | written_qualifier |
|---|---|---|
| `widgets.cpp:4` definition | `alpha.Widget.render` | `[Widget]` |
| `widgets.h:8` declaration | `src.widgets.alpha.Widget.render` | absent |

Both carry `lexical_scope = [{segment: alpha, authority: lexical_ast}]`.
Controls in the same pass: 5 rows for label `render` (positive), 0 rows for a label known absent
(negative), so the query can say both PRESENT and ABSENT.

## Mechanism — read in `mcp/stdio/ingest/extractors/generic.js`

```js
const qname = scopedParent
  ? `${scopedParent}.${name}`                                   // NO moduleLabel
  : `${moduleLabel}.${scopePrefix ? `${scopePrefix}.` : ''}${name}`;
```

Both rows take the FIRST branch. The divergence is in what `scopedParent` holds, and the source
comment already names the two as different kinds of thing:

- **definition** — `symbolInfo.parentClassQname` is the qualifier AS WRITTEN (`Widget`), which is
  scope-relative and gets `lexicalScope` composed onto it → `alpha.Widget` → module-free.
- **declaration** — there is no written qualifier, so the parent is the in-scope Class node's
  `extra.qname`, which is ABSOLUTE and already module-prefixed (`src.widgets.alpha.Widget`). The
  guard against double-prefixing is a `startsWith` check, and it cannot see the scope because it
  sits mid-string after the module label.

⇒ For any out-of-line C++ definition the two forms are guaranteed to differ. The invariant stated
in `mcp/stdio/query/verbs/symbol_lookup.js` — *"Overloads and the C++ decl/def split share a
canonical key → one group → not ambiguous"* — is FALSE for exactly the case it names.

## Why the obvious fix is wrong

Dropping the module prefix globally would MERGE genuinely distinct symbols. Measured on the JS
fixture, where the two classes are real and different:

```
src.alpha.Widget.render     src/alpha.js:2
src.beta.Widget.render      src/beta.js:2
```

These differ ONLY by module. Without namespaces the module prefix is the sole discriminator, so it
is load-bearing in JS and harmful in C++. Any fix must be aware of that difference rather than
picking one form globally.

## Not claimed

- **NOT that the edge layer is fixed.** It is not. Attribution remains UNAVAILABLE
  (`ALL_TARGETS_UNRESOLVED`, 2 edges, both `External`). That is a separate defect, below this one.
- **NOT a prevalence claim.** One fixture. This says the shape is guaranteed by construction; it
  says nothing about how often out-of-line definitions occur in real C++ populations.
- **NOT that collapsing decl/def is sufficient for M1.** It removes the refusal that makes
  `selectedTargets=0`; caller sets still require the edge layer to resolve method calls.

## The method-dispatch defect underneath, with its control

Same JS fixture, same file, same run — `alphaCaller` makes two calls:

| call | attribution | target type | concrete |
|---|---|---|---|
| `alphaHelper()` plain function | AVAILABLE | `Function` x2 | 2 |
| `w.render()` method | UNAVAILABLE | `External` x2 | 0 |

The predicate discriminates, so the zero is real rather than an instrument that always says no.
The failure is specific to METHOD dispatch, and it is not the compile database — JavaScript uses
none.
