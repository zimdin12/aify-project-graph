# apg-pilot-02 and -03 — task answers (arms sealed)

Both answered **NO — do not delete**, citing `pipeline.cpp:1` (extern) and `:3` (call).
Both independently found the unity build (`bundle.cpp` includes both .cpp files).
Both ran positive AND negative grep controls in the same run, unprompted.

## apg-pilot-02
- `code_intel_references` with warmupFiles, waitForReadyMs 25000 → 1 ref, clangd@live, confidence high
- quoted evidence verbatim incl. `exhaustive=false` and the missing-compile_commands warning
- read the caveat correctly: *"That withheld-exhaustive caveat only limits ZERO answers."*
- **saw the torn state and said so**: graph_health `absenceAuthority=false`,
  attestation **`generation_mismatch`** — and judged it *"irrelevant here, since the answer
  rests on a found caller, not on a zero"*
- ran a case-insensitive substring sweep as well, to catch a string/config/mangled reference
- offered a reversible proof: stub the symbol to throw and build; a link error names any
  caller the search missed

## apg-pilot-03
- read all 8 files directly — *"it is small enough to read exhaustively rather than sample"*
- grep + both controls; `code_intel_references` → 1 ref, clangd@live
- stated the corollary precisely: *"exhaustiveness is only needed to say yes"*, and that a
  ZERO here could NOT have been certified — no compile DB, `absenceAuthority=false`,
  reason `no_collection`
- noticed `weights.cpp` is `#include`d as a source, so edits change bundle.cpp's TU too
