# Receipt binding — suite-0acbaa2-GREEN.txt

Interpretation lives HERE; the raw capture is byte-preserved.

| field | value |
|---|---|
| subject commit | `0acbaa298f4f690197ac901428b035976974a309` |
| tree at run | clean — 0 modified, 0 untracked |
| VITEST_EXIT | **0** (log line 998, not the harness notification) |
| raw receipt | `suite-0acbaa2-GREEN.txt` |
| raw receipt sha256 | `977006e7a9fabb0303ab731763bbe9bc367c8a729244d02ccf21ced32086d455` |
| test files | 423 passed |
| tests | 3553 passed, 4 skipped |
| failed assertion lines | 0 |
| `git diff --check c757a32..0acbaa2` | clean |

## ⚠ `69ec796` was NEVER measured on its own

`origin/main` advances directly from `c757a32` to `0acbaa2`. No suite ran on `69ec796` in
isolation. **The accepted integration subject is the combined `0acbaa2` tree**, not two
independently-verified commits. The commit boundaries keep the sidecar and the partition change
separately *inspectable* — that is readability, not evidence, and transport must not imply
otherwise.

## What this receipt certifies

The full suite passes on exactly `0acbaa2`, including the snapshot access-partition controls.

## What it does NOT certify

- the shared `lsp-collect` admission path — still unguarded, explicitly open;
- any latency or reliability claim for the document snapshot — the A/B timing was inconclusive and
  its sample biased by conditioning on success;
- that the load-sensitive budget-limited integration test is a reliable gate — it failed in **both**
  A/B arms (3/6 and 1/6) and that gate remains open;
- how failures behave in the field. The measured run had **0 refused-invalid and 0
  unavailable-unverified**; the leaf controls qualify the accounting *mechanism*, but a run
  containing no failures cannot certify failure behaviour;
- clangd's upstream directory-URI cause — unexplained, six candidates falsified.

## Measured, bounded exactly as reported

- `snapshotAccesses` **2051 = 2049 hits + 2 captured-document misses**
- coherence-eligible locations **2051 = 2001 retained records + 50 capped references**
