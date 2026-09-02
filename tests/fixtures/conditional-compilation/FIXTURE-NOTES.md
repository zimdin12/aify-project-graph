# conditional-compilation

Exists for ONE observed fact, which corrected a claim this project had already shipped.

`driver()` contains two calls. `hiddenCall()` sits inside `#ifdef FEATURE_X`, and nothing defines
FEATURE_X, so it never compiles. `visibleCall()` is always compiled and is the positive control.

Measured with a generated compile DB (no `-DFEATURE_X`):

    driver -> visibleCall   conf=0.95 [lsp✓]   clangd resolved it
    driver -> hiddenCall    conf=0.60          heuristic only, NO lsp marker

⇒ The two evidence tiers fail in OPPOSITE directions on conditional compilation. tree-sitter parses
TEXT and never evaluates the preprocessor, so it reports a call that can never execute (OVERCOUNT).
clangd compiles one configuration and omits it (UNDERCOUNT).

⛔ The shipped caveat used to say an inactive branch was "invisible to BOTH tiers". That was derived
from the compile-database model and never observed; it is wrong about the heuristic tier.

⚠ No `compile_commands.json` is tracked here — its `directory`/`file` entries are absolute, so a
committed one would be wrong on every other machine. The clangd half is reproduced by
`scripts/m2-conditional-compilation-probe.mjs`, which generates one.
