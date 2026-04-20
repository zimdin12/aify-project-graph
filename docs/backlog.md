# Backlog

Known limits and follow-up tickets. Prioritized by observed impact in real repos.

## P1 post-launch — cross-tester bench agreed follow-ups

These three items were deferred from the 2026-04-20 pre-launch scope-cut with explicit two-tester agreement. Evidence base is `docs/dogfood/ab-results-2026-04-20-cross-tester.md`.

### Laravel-specific EXPORTS brief contributor
**Problem**: generic route detection in `extractExports()` catches `Route::apiResource(...)` declarations but misses Laravel's middleware-alias resolution and controller method chains. lc-api was the weakest repo in both testers' bench runs (dev saw orient regression, search at parity) — framework-aware brief sections would close the gap. Dev's fresh single-tester analysis promoted this from "architectural nice-to-have" to P1 post-launch: *"framework-aware brief generation is justified by my lc-api results, not just taste"*.

**Scope**:
- New file `mcp/stdio/brief/contributors/laravel.js`
- Parse `app/Http/Kernel.php` for `$middlewareAliases` + `$middlewareGroups`
- For each declared route, resolve its middleware chain + terminal controller method
- Emit as `ROUTES:` sub-section under EXPORTS (same universal section name, richer content for Laravel codebases)
- Add contributor hook in `generator.js` so other frameworks (Express, FastAPI, Django, Rails, NestJS) can plug in the same way

**Not in scope**: dynamic route registration, runtime middleware registration.

### Phase 2 overlay-dependent bench (32 cells)
**Problem**: the 2026-04-20 24-cell bench measured parity, not gains — the task shapes (orient/search/trace) are all shell-accessible so baseline subagents could reach correct answers without the brief. Brief-only never scored HIGHER than baseline in either tester's data, only faster/cheaper.

**Scope**: add 4 new task shapes that leverage what ONLY the brief has (`functionality.json` overlays):
1. `pre-delete-impact` — "what features/tests/tasks break if we delete `<file>`?"
2. `feature-drilldown` — "list all files/tests/tasks under feature `<X>`"
3. `trust-assessment` — "is subsystem `<X>` indexed reliably enough?"
4. `recent-in-feature` — "what changed in feature `<X>` over the last week?"

Run 4 tasks × 4 repos × 2 arms = 32 cells. Expected to show quality GAINS: baseline can't easily reconstruct these answers from grep + git; brief has them pre-computed.

**Why deferred**: launch claim doesn't include "better than baseline" so not a blocker. Adds additive "quality gains on overlay-dependent tasks" to the README once landed.

### Fresh rerun of `echoes.trace brief-only`
**Problem**: contaminated data row from the earlier broken-harness path (`effective_tokens=0`, empty answer). Already excluded from aggregate interpretation but worth having a clean replacement row for the artifact.

**Scope**: dev reruns that single cell via clean manual harness, overwrites the suspect row in `docs/dogfood/ab-2026-04-20-graph-senior-dev-results.json`. ~5 min.

## P2 post-launch — polish

### `PATHS:` brief section (pre-computed traces)
**Problem**: trace tasks barely benefit from brief in current form. Both testers saw minimal savings on trace (my −9% aggregate, dev's mixed).

**Scope**: at brief-gen time, call `graph_path()` for top-N EXPORTS entries, emit ordered file:function chains as `PATHS:` section. ~80 lines in `mcp/stdio/brief/generator.js`. Uses `graph_path` verb from `mcp/stdio/query/verbs/path.js`.

### Per-subsystem briefs for large repos
**Problem**: brief value scales inversely with repo size. Small/medium repos (apg 134 files, echoes 338 files) get −27% to −37% token savings; large repos (mem0 926 files, lc 1819 files) get under −10%. The brief is bounded ~300 tokens regardless of repo size.

**Scope**: generate `brief.<subsystem>.md` per top subsystem for repos above some threshold. Agent picks relevant brief per task. Architectural change.

## P3 post-launch — speculative

### Task-shape-specific brief variants
**Problem**: brief section ordering is one-size-fits-all. Search tasks need EXPORTS first; trace needs PATHS first; orient needs SUBSYS + FEATURES first.

**Scope**: `brief.search.md`, `brief.trace.md`, `brief.orient.md` variants with shape-optimized ordering. Speculative until evidence warrants.

---

## Previously open tickets

## P1 — would move known trace-task losses

### Laravel middleware-group expansion (Item G)
**Problem**: lc-api trace task loses to grep by +12.5% because `Kernel.php`'s middleware groups are declarative arrays the extractor doesn't model. Graph traversal dead-ends at the route-to-controller boundary.

**Scope (v1, conservative)**:
- Extend `mcp/stdio/ingest/frameworks/laravel.js` to parse `app/Http/Kernel.php`.
- Emit `PASSES_THROUGH` (new relation) edges: `Route → middleware_handle_method` for each middleware listed in the route's group.
- Only static/declarative middleware declarations; no runtime-registered middleware.
- Test with lc-api `allow-end-user → require-token + throttle-non-intrusive` chain.

**Not in scope**: dynamic `Route::middleware([...])` fluent calls (harder AST walk), `terminate()` / post-handler middleware.

## P2 — completeness

### Custom Laravel facade discovery (Item F, descoped)
**Problem**: lc-api / most real Laravel apps register custom facades (`App\Facades\SkipPaid`, etc.) via service providers. Static FACADE_MAP only covers 20 Illuminate built-ins.

**Scope (v1, config-first per dev)**:
- Support `.aify-facades.json` at repo root. Format: `{"SkipPaid": "App\\Services\\SkipPaidChecker", ...}`.
- Merge into FACADE_MAP at PHP postExtract time.
- Provider auto-discovery (scan `app/Providers/*.php` for `$this->app->bind()` + `Facade::getFacadeAccessor()`) is separate, larger ticket.

### C++ nested / SFINAE templates
**Problem**: `Foo<T, U>::bar()` with multiple template args works; `Foo<Inner<T>>::bar()` may not; SFINAE specializations (`template<> void Foo<int>::bar()`) unclear.

**Scope**: extend the AST walk in `extractCppFunctionSymbol` to handle nested `template_type` and `template_declaration` wrapping.

### ECS libraries beyond flecs/entt/bevy
**Problem**: current ECS_TERMINATOR_FIELDS is `{each, iter, run, for_each}`. Other libs may use `.query()`, `.exec()`, etc.

**Scope**: add library-specific detection triggered by `#include <lib.h>` presence.

## P3 — nice-to-have

### Identifier-level REFERENCES for JS/TS
**Problem**: unlike Rust, JS/TS use the implicit fallback (any identifier becomes REFERENCES). Could be noisy on large codebases.

**Scope**: decide whether to explicitly set `references: []` or keep fallback; measure token impact.

### Python type annotations as USES_TYPE (beyond existing parameter extraction)
**Problem**: module-level type aliases (`UserId = int`) and generic-type parameters (`list[User]`) not captured.

**Scope**: extend python.js `refs.usesTypes` rules.

### Graph `graph_path` verb improvements
**Problem**: path rendering doesn't yet show External terminals differently from internal ones in all cases.

**Scope**: renderer update to consistently tag external hops in path output.

## Won't do (documented as limits)

- **Runtime reflection / eval / metaclasses**: inherent limit of static analysis.
- **Service-container dynamic dispatch** (`$factory->create($kind)`): statically the return type is a base class; concrete type only known at runtime.
- **JIT-registered routes / middleware** via `Route::*` fluent calls in runtime code (as opposed to `routes/*.php`).
