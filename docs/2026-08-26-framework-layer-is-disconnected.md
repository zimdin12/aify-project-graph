# The framework layer does not connect to the code layer

Steven's stated goal for this tool is *"a second brain for agents — connected layers"*. On a web
application using a supported framework, two of those layers do not touch.

## What was fixed here, and what it is worth

`hubs()` and `risks()` in `graph-shape.js`, and `graph_report`'s hub query, rank symbols by inbound
edges — "what is most depended upon". All three filtered `relation IN ('CALLS','REFERENCES')`.

But this repo's own framework ingesters — `laravel.js`, `nestjs.js`, `node_web.js`,
`python_web.js` — emit `INVOKES` and `PASSES_THROUGH` for route → middleware → handler chains. On a
Laravel, NestJS, Express or Flask app those are the handler's inbound edges, so the symbols the
application is organised around scored a fan-in of **zero** and never ranked.

⛔ **The same file already knew better**: `graph-shape.js:135` walks
`['PASSES_THROUGH','INVOKES','CALLS']` for path exploration. Two notions of "call-ish edge", 100
lines apart.

All four sites now derive from `CALL_FAMILY`. `file.js`'s two lists were already set-equal to it and
were centralised in the same pass so they cannot drift.

⚠ **MEASURED EFFECT ON EVERY GRAPH I CAN REACH: NONE.** Executed side by side against the old
filter, the top-8 hubs are byte-identical on all four pinned arms — because all four contain **zero**
`INVOKES` and zero `PASSES_THROUGH` edges, as does this project's own graph. None is a web app on a
supported framework. The relations are not dead vocabulary; the corpus cannot express them.

## Then a real Express app was indexed, and the fix turned out to be blocked

A minimal Express app (3 routes, 2 middleware, 2 handlers, all repo-local) was built and indexed by
the **real** `reindex.mjs`. It produced real routed edges:

    PASSES_THROUGH 6    DEFINES 5    CONTAINS 4    CALLS 3    IMPORTS 2    INVOKES 1

And `hubs()` still returned `[]` — before *and* after the fix. Because of this:

    INVOKES         Route:GET /orders/:id  ->  External:createOrderHandler
    PASSES_THROUGH  Route:POST /orders     ->  External:requireAuth
    PASSES_THROUGH  External:requireAuth   ->  External:rateLimit
    PASSES_THROUGH  External:rateLimit     ->  External:createOrderHandler

⛔ **Every routed target is an `External` node, while the same function exists as a real `Function`
node in the same repository, and nothing links the two:**

| label | `Function` node | `External` node | edges between them |
|---|---|---|---|
| createOrderHandler | YES `src/handlers.js` | YES | **0** |
| listOrdersHandler | YES `src/handlers.js` | YES | **0** |
| requireAuth | YES `src/middleware.js` | YES | **0** |
| rateLimit | YES `src/middleware.js` | YES | **0** |
| formatMoney | YES `src/handlers.js` | no | n/a |

⭐ `formatMoney` is the positive control: a function defined in the same file, never used in a route,
has no `External` twin. The duplication is caused by the framework path specifically, not by every
function.

## Where the defect is — and where it is not

The plugin is **not** at fault. `node_web.js` emits `refs` — deferred targets carrying a name for a
resolver to bind (`{ relation: 'PASSES_THROUGH', target: 'requireAuth', … }`) — not direct edges to
`External` nodes. Those refs are merged into the orchestrator's normal `refs` list and go through the
ordinary resolution path.

⇒ **The resolution pass ran on them and produced `External` anyway.** In `src/routes.js` the handlers
arrive via `require('./handlers')`, so binding the bare identifier to a repo-local definition means
following that import. `External` is the correct answer for genuinely third-party middleware; it is
the wrong answer for a symbol defined two files away.

## Consequences, stated as what an agent gets

- `graph_callers("createOrderHandler")` cannot see the route that routes to it.
- The route chain terminates in a stub with no file, no line, no body.
- Hub and risk ranking exclude routed targets regardless of the filter, because `External` is not in
  the node-type filter.

## Honest status of the fix in this commit

- **PROVEN:** the relation filter admits routed edges; 3 mutants killed, including one that widens
  to every relation (a hub score must not be inflated by `DEFINES`).
- **PROVEN:** the framework plugins are wired unconditionally into `graph_index` — not behind a flag
  — so routed edges are produced in practice, as the Express probe demonstrates.
- **INERT TODAY:** on every real graph measured, the fix changes nothing, and on a real framework app
  it remains blocked by the resolution defect above.

⇒ It is a prerequisite, not an improvement. When resolution binds routed targets to repo symbols,
this filter is what lets them rank; until then it is correct and idle. Claiming otherwise would be
the "quality of the unreachable" pattern this repo keeps re-committing — improving something no
consumer receives.

## ⚠ One test passed for the wrong reason

The ranking assertion was first written as a bare `indexOf(handler) < indexOf(helper)`. It was
**green against the unfixed code**: the handler was absent, `indexOf` returned `-1`, and `-1 < 0`.
A ranking assertion over a missing element is not a ranking assertion. Both positions are now pinned
as present before being compared.
