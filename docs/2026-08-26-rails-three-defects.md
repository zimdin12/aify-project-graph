# Rails — three defects, found by building one fixture

The last two frameworks without an end-to-end fixture were Rails and Spring. Spring bound **2 of 2**
routed edges on the first try. Rails bound **1 of 8**, and finding out why turned up three separate
defects stacked on each other.

## Defect 1 — the target was a bare action name, which the denylist eats

The plugin emitted `target: r.action`, with a comment stating the intent:

> *"We emit the action identifier alone (the resolver will match it against Method nodes by label)."*

Label matching is exactly what `COMMON_NAMES` blocks. Measured:

    index    DENYLISTED        create   DENYLISTED        update   DENYLISTED
    show     ok                destroy  ok                new/edit ok

Three of the seven standard Rails actions — and the create/read/update of every resource — can never
resolve by bare label. `resources :articles` produced **8 route nodes and 1 bound edge** (`show`).
`index` was defined in the controller and still did not bind.

⚠ **The denylist is not the bug.** It exists so a bare `CALLS get` ref cannot match hundreds of
unrelated `get` methods. A route ref is not a guess — the plugin has the controller right there in
`r.controller` — so the fix is to stop discarding it, not to weaken the guard. `laravel.js` already
emits `${controller}.${action}` for precisely this reason.

**Prediction registered before the change:** `index` and `show` bind (the two the fixture defines);
`new/create/edit/update/destroy` stay unbound. **Result: 2 of 2, exactly as predicted.**

## Defect 2 — `#` is Ruby's comment marker *and* the route separator

Each line was pre-processed with:

    const line = rawLine.replace(/#.*$/, '');   // strip trailing comment

So `get 'dashboard', to: 'admin_reports#index'` became `get 'dashboard', to: 'admin_reports` and
matched nothing. **Every explicit `to:` route produced no Route node at all.** `resources :articles`
contains no `#`, which is the only reason anything worked.

Replaced with a quote-aware scanner: only a `#` outside a quoted string starts a comment.

## Defect 3 — a control that could not fail

The mutant *"stop stripping comments entirely"* **survived** two tests I had written as controls:

- a whole-line comment: the parsers anchor at `^\s*`, so a line starting with `#` never matches
  regardless of stripping;
- a trailing comment after a complete route: the lazy `.*?` reaches the **first** `to:` — the live
  one — either way.

Both passed for reasons unrelated to what they claimed to check. The shape where stripping actually
decides the answer is a live line with **no** `to:` of its own:

    get 'a' # to: 'ghosts#index'

Unstripped, the regex reaches **across** the `#` and invents `GhostsController.index` — an endpoint
that exists only inside a comment. That test now exists, and the mutant dies.

⇒ **A control that passes under the mutation is not a control.** Two of mine were decoration until a
mutant proved it.

## Evidence

| framework | routed edges | bound |
|---|---|---|
| Spring | 2 | **2 / 2** |
| Rails, before | 8 candidate actions | **1** (`show` only) |
| Rails, after | 8 candidate actions | **2** — `index` + `show`, the two defined |

Both fixtures indexed by the real `scripts/reindex.mjs`. The six undefined actions correctly produce
no edge, and `unrouted_helper` — defined but never routed — correctly has none either: both error
directions present in one run.

**4 mutants, 4 killed:** bare action name · quoted `#` eaten again · comments never stripped ·
`Controller` suffix dropped.

**Suite: 374 files, 3,023 passed, 4 skipped, 0 failed.**

## What this says about the arc

Every framework now has an end-to-end fixture: Express, FastAPI, Django, Laravel, NestJS, Qt, Rails,
Spring. The last two were added *because* they were the only ones still asserted rather than proven —
and the one that had never been exercised end-to-end held three defects, two of which the
enumeration guard could not see because they were about route *discovery*, not about the language
field it checks.

⇒ **Coverage of one property is not coverage.** The guard proved every plugin attaches a language;
it had nothing to say about whether the plugin finds its routes at all.
