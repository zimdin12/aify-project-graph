# Backlog

Known limits and follow-up tickets. Prioritized by observed impact in real repos.

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
