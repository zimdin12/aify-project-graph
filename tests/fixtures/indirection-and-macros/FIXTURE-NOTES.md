# indirection-and-macros

Exists for the two NEGATIVE claims in the shipped construct-coverage caveat — the dangerous kind,
because they assert the tool CANNOT see something.

Measured (plain call as positive control, generated compile DB, no `-D` flags):

| construct | heuristic (tree-sitter) | clangd |
|---|---|---|
| `directTarget()` plain **[CONTROL]** | edge conf=0.60 | edge conf=0.95 `[lsp✓]` |
| `ptrTarget` via function pointer | **NO EDGE** | edge conf=0.95 `[lsp✓]` |
| `macroTarget()` via `CALL_IT()` | **NO EDGE** | **NO EDGE** |

⇒ Only the MACRO case is blind in both tiers. The function-pointer case is blind in the HEURISTIC
tier only — clangd resolves it. An earlier version of the shipped caveat claimed both were
unmodelled outright; that was derived, not observed, and wrong for clangd.

⚠ The heuristic half is what this fixture's test asserts, because it needs no LLVM install and it is
OUR behaviour. The clangd column is third-party and stays in a script.

⚠ No `compile_commands.json` is tracked — its paths are absolute and would be wrong elsewhere.
