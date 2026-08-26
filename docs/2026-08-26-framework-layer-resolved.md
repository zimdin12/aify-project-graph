# RESOLVED — a framework tag was being read as a language

Companion to `2026-08-26-framework-layer-is-disconnected.md`, which measured the defect.

## The cause, in one line

`filterByLanguageFamily` computed `languageFamily(ref.extractor)`, and `languageFamily` returns its
input unchanged for anything it does not recognise. So `extractor: 'node-web'` became the *family*
`"node-web"` — which matches no node in any graph. `INVOKES` and `PASSES_THROUGH` are hard-gated
relations, so the filter returned `[]`, resolution failed, and the routed target was materialised as
an `External` stub beside the very function it should have bound to.

## It had been hit before, and fixed for exactly one framework

`LANGUAGE_FAMILY` carries a lone entry: `['laravel', 'php']`, commented *"Laravel plugin emits
routes as PHP"*. Enumerated across every framework extractor tag in this repo, **laravel was the
only one that resolved**:

| tag | ref family | target family | hard-gated ref resolves? |
|---|---|---|---|
| laravel | php | php | YES |
| nestjs | nestjs | js_ts | **NO** |
| node-web | node-web | js_ts | **NO** |
| python-web | python-web | python | **NO** |
| django | django | python | **NO** |
| rails | rails | ruby | **NO** |
| spring | spring | java | **NO** |
| qt | qt | c_cpp | **NO** |
| cmake | cmake | unknown | **NO** |
| shader-bindings | shader-bindings | glsl | **NO** |

⇒ One framework was fixed by name and nine were left. **A hand-written map is a defect with a delay
on it** — the same shape as the two hardcoded compile-DB lists and the 12-word doc allowlist.

## The fix derives instead of listing

The plugin already computes the language per file and puts it on the Route node. `invokesRef` now
carries it onto the ref, and the resolver prefers `ref.language` over `ref.extractor`. Refs without a
language behave exactly as before, so nothing existing changes.

⚠ **The gate is not weakened.** A JavaScript route still refuses to bind to a Python function of the
same name — that is what the gate is for, and a mutant disabling it is killed.

## Evidence — the same Express app, reindexed by the real pipeline

| label | before | after |
|---|---|---|
| createOrderHandler | Function + unlinked External | **Function only, bound** |
| listOrdersHandler | Function + unlinked External | **Function only, bound** |
| requireAuth | Function + unlinked External | **Function only, bound** |
| rateLimit | Function + unlinked External | **Function only, bound** |
| `cors` (third-party) | External | **External** — negative control |

The chain now resolves end to end, and third-party middleware still participates *as* external:

    INVOKES         Route:POST /orders     ->  Function:createOrderHandler
    PASSES_THROUGH  Function:requireAuth   ->  Function:rateLimit
    PASSES_THROUGH  Function:rateLimit     ->  Function:createOrderHandler
    PASSES_THROUGH  Route:GET /public      ->  External:cors
    PASSES_THROUGH  External:cors          ->  Function:listOrdersHandler

What an agent now gets:

    graph_callers("createOrderHandler")
      EDGE POST /orders -> createOrderHandler      INVOKES         src/routes.js:6
      EDGE GET /orders/:id -> createOrderHandler   INVOKES         src/routes.js:8
      EDGE rateLimit -> createOrderHandler         PASSES_THROUGH  src/middleware.js:2

⭐ `hubs()` now returns `listOrdersHandler:4, createOrderHandler:3, requireAuth:3, rateLimit:1` — the
previous commit's fan-in fix, shipped as a **prerequisite**, becoming live exactly as predicted. It
was correct and idle; this is what it was waiting for.

**Regression control:** p-queue (no framework refs) reindexed to **184 nodes / 384 edges —
identical**. The change is inert where no ref carries a language.

**5 mutants, 5 killed.** Suite: 371 files, 3,000 passed, 4 skipped, 0 failed.

## Coverage — what is proven, and what is asserted

- **PROVEN end-to-end** (real app, real indexer): `node-web`.
- **Fixed through the shared `invokesRef` derivation, not individually executed**: `django`,
  `python-web`, `rails`, `spring`, `nestjs` — each supplies a language on its route node.
- **Fixed by the same one-line derivation at raw ref sites, not executed**: `nestjs` (3 sites),
  `qt` / `cpp_frameworks` (3 sites).
- **Already worked**: `laravel`, via the legacy map entry. Left alone deliberately — changing a
  working path with no Laravel fixture would trade a known good for an unknown.
- **Unaffected**: `shader-bindings` (`LOADS_SHADER` is bridge-exempt; `DECLARES_BINDING` and
  `IMPORTS` are not hard-gated), `cmake`.

## ⛔ Four self-inflicted errors

1. **A field silently dropped at a re-wrap.** `resolveOwner` rebuilds a synthetic ref to look up
   `from_target` and did not copy `language` — so the middle links of a chain still failed while the
   last one bound. Reading the fix looked complete; only reindexing the real app showed the split.
2. **A mutant survived, and it was the one that mattered.** The first sweep left *"resolveOwner drops
   the language"* GREEN, because no test covered the symbolic-source path. A ref whose source is a
   **name** exercises different code from one whose source is an **id**.
3. **A test that pinned nothing.** `chainRef(node, target, { language: undefined })` — a
   destructuring default substitutes *precisely when the value is undefined*, so the ref still
   carried the language and the "defect pinned" test was green against the behaviour it claimed to
   pin. Replaced with an explicit `omitLanguage` flag.
4. **An assumption about materialisation.** The first draft asserted a lone `INVOKES` ref mints an
   `External` stub. It does not — `shouldMaterializeExternal` omits `INVOKES`. In the real index the
   stub came from the `PASSES_THROUGH` ref and the `INVOKES` ref then bound to it: order-dependent
   behaviour I mistook for a property.
