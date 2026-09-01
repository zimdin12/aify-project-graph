# identity-callers-js — why the manifest files are load-bearing

`package.json` and `tsconfig.json` are NOT decoration. Without them tsserver treats each file as an
isolated script and resolves nothing across files. Measured on this fixture, same bytes otherwise:

| | bare | with manifest |
|---|---|---|
| reference records `found` / `not_found_after_retry` | 2 / 8 | 14 / 2 |
| CALLS edges created by the LSP import | **0** | **10** |
| `alphaCaller -> render` | `External` | `Method`, `src/alpha.js` |
| `betaCaller -> render` | `External` | `Method`, `src/beta.js` |

The 2 references that resolve WITHOUT the manifest are for `w`, a local variable, whose only
references sit inside its own definition range and are correctly skipped as declarations. So a
manifest-less run produces zero caller attribution and looks exactly like a broken resolver.

⛔ This cost real conclusions. The step-B write-up recorded caller attribution as "structurally
unavailable — the edge attaches to neither definition", and a later re-measurement reproduced it.
Both ran against the manifest-less fixture. The system was not broken; the fixture was
unconfigured, and a fixture that cannot exercise the feature makes the feature look absent.

Do not remove these files to "simplify" the fixture.
