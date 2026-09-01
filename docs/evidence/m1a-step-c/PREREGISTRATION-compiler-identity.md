# Compiler-identity authority qualification: PREREGISTRATION

Written **before** the experiment. This is its own experiment, not part of C1. "clangd is
installed" must not silently redefine C1's evidence condition.

**Outcome rule, fixed now.** Pass → this exact fixture and carrier become C1's liveness gate.
Fail → C1's liveness is unmet, and that does **not** license spelling as a substitute.

## Why this exists

Every C++ result in this arc was measured with **no compile database**. I twice treated that as a
*cause* without testing it — once claiming the unresolved method targets were "the missing compile
DB", falsified by the JS control where a method call also lands on `External` with no compile DB
involved.

⚠ **The existing no-compile-DB observations stay intact.** A successful compiler-backed run is a
**new evidence condition**, not a correction to them.

⛔ **Out of scope: C2's method-call binding question.** Whether a compile DB changes `w.render()`
edge binding gets its own preregistered replication *after* C1. This experiment must not
retroactively answer it — an earlier draft of mine listed it as question 1, which would have let
C1's qualification run settle C2's central question as a side effect.

## Question

**Is compiler identity the authority C1 needs?** Not "does collection run" — that is a
precondition, not the finding.

## Carrier identity — frozen and recorded

Source bytes (per-file SHA-256) · `compile_commands.json` bytes + hash · **absolute** paths and
versions of `clang-cl` and `clangd`, with binary hashes · exact flags · working directory ·
`APG_CLANGD` value.

⚠ **Preserve `compile_commands.json` EXACTLY AS CONSUMED**, absolute paths and all. The receipt is
the bytes clangd actually read. A normalized or path-scrubbed view may sit beside it to aid
comparison, but **cannot replace** the consumed bytes — normalizing the artifact under test is how
a receipt stops describing the run that happened. The fixture root is recorded as environment
disclosure rather than edited out of the evidence.

⚠ Use the explicit absolute path. **Do not mutate ambient `PATH`** — a run that only works because
the environment was edited is not reproducible, and the edit outlives the measurement.

Known: `C:\Program Files\LLVM\bin\clangd.exe` 22.1.6 `x86_64-pc-windows-msvc` (exit 0),
`clang-cl.exe` 22.1.6, `ninja` 1.13.2, `cmake` 4.3.3 — all verified running, not merely present.
`clangd` is **not on PATH**; a `command -v` check alone filed a false blocker and nearly stopped C1.

## 1. Site coverage — ground truth enumerated BEFORE collection

Enumerate every source site in the frozen fixture first. Then report **each one** as
`represented` / `unrepresented` / `ambiguous` in clangd output.

**No count-only pass.** "N records collected" cannot stand in for "these specific sites were
represented", and an unrepresented site is not an absent symbol.

## 2. Equivalence discrimination — the actual test

| population | required |
|---|---|
| legal decl/def pair | **grouped** under one compiler identity |
| `alpha::Widget::render` vs `beta::Widget::render` | distinct |
| `render(int)` vs `render(float)` — same arity | distinct |
| `render()` vs `render() const`, `&` vs `&&` | distinct |
| template vs non-template | distinct |
| `render(int)` vs `render(Scalar)` where `using Scalar = int` | **PREDICTED: the SAME identity, not two overloads** |

The last row is a preregistered prediction that clangd can falsify. Spelling calls these two
*different*; the language says they are one function. If clangd agrees with spelling, compiler
identity is weaker than assumed here and that is the finding.

## 3. Site mapping — a shared id is not enough

Every compiler identity must map back to the **intended graph site rows by file and span**. A
shared symbol id with ambiguous or last-writer-wins site mapping does **not** satisfy C1: it would
merge the right sites by accident and the wrong ones silently.

## 4. Lineage and freshness — all typed, never spelling

Stale compile DB · changed source bytes · missing or unreadable clangd · partial collection ·
unrepresented sites → typed `UNKNOWN` / `UNAVAILABLE`. **None may fall back to spelling
equivalence.**

## 5. Consumption mutant

After qualification, **removing the compiler-identity relation must restore C1's false ambiguity**.
If it does not, the authority is present but inert — the unreachable-carrier shape this project
keeps rediscovering, and it would mean the merge was really happening by some other route.

## Controls

| Control | Purpose |
|---|---|
| **the DB is real** | every entry names `clang-cl`, not `cl.exe`. A configure can silently fall back to MSVC and yield a DB clangd cannot compile (`compile-db.js:818`) — it would look like a clean run |
| **clangd actually ran** | non-zero record count with `result_state`. Zero records is never "resolved to nothing" |
| **no-DB baseline reproduces** | the same fixture without a DB must still show `{External: 2}`, proving any change is the DB and the instrument still shows the old result |
| **positive control on every zero** | a query returning nothing requires a known-good symbol in the same TU returning something, in the same run |

## Claim ceiling

Three source files, one fixture, one host, one clangd version, one compiler. A result here is a
claim about **this fixture under this toolchain** — never about C++ generally, never about a real
repository at scale (M5). And "clangd resolves it" is not "the pipeline resolves it": the records
must be shown reaching the graph, not merely produced.

## Abandon rule

If the DB cannot be generated with `clang-cl` entries, or clangd produces zero usable records,
**stop and report that**. Do not hand-write a `compile_commands.json` no compiler validated. Do not
weaken C1's authority to spelling to keep the milestone moving. An inert-but-honest C1 is a
reportable outcome; a spelling-based merge wearing an identity claim is not.
