# Compiler-identity authority qualification: **FAIL** — plus two defects found on the way

Preregistration: `PREREGISTRATION-compiler-identity.md` (written before the run)
Carrier identity: `receipts-carrier-identity.txt` · Consumed DB: `compile_commands.as-consumed.json`
(preserved verbatim, absolute paths intact, sha256 `8d5becad…`, byte-identical to the file clangd read)

**Outcome rule, fixed in advance:** pass → this carrier becomes C1's liveness gate. Fail → C1's
liveness is unmet, and that does **not** license spelling as a substitute.

**Result: FAIL.** C1's liveness gate is unmet.

## The toolchain ran — that was never the finding

| tool | version | evidence |
|---|---|---|
| clangd | 22.1.6 `x86_64-pc-windows-msvc` | `--version` exit 0, sha256 `ad7fd474…` |
| clang-cl | 22.1.6 | sha256 `f168b58c…` |
| cmake / ninja | 4.3.3 / 1.13.2 | on PATH |

`clangd` is **not on PATH**; reached by absolute path via `APG_CLANGD`. Ambient `PATH` was not
mutated. **Control passed:** both `compile_commands.json` entries name `clang-cl`, neither names
`cl.exe`, so the silent-MSVC-fallback failure mode did not occur. Collection reported
`status: ok`, `filesProcessed 2/2`, 14 records.

## Q3 — is there a compiler identity linking a declaration to its definition? **No.**

`cpp-clangd.js:123`:

```js
function symbolIdFor(file, line, col) {
  return `c:cpp:${file}:${line}:${col}`;
}
```

The persisted `symbol_id` is **positional** — a file/line/column address. Despite the name it is
not a compiler symbol identity, and a declaration and its definition sit at different positions, so
**they cannot share it by construction**. 6 definition records, 6 distinct ids.

Standard LSP `documentSymbol` does not expose USRs; clangd's `SymbolID` lives in its index, which
this provider does not consume. So the authority C1 requires is not merely unpopulated here — the
current provider has no route to it.

**Consequence, per the preregistered outcome rule:** C1's `EQUIVALENT` state has no available
authority. C1 must not proceed by weakening to spelling. An inert-but-honest C1 is the reportable
outcome; a spelling-based merge wearing an identity claim is not.

**Not yet explored, and named rather than assumed:** the provider already resolves *references* to
their definition's position — reference and definition records for the same symbol share an id. If
`textDocument/definition` on a header declaration returns the `.cpp` definition, that would be a
compiler-derived decl→def linkage without a USR. Untested. It is a candidate route for C1, not a
result.

## ⛔ Defect 1 — `compile_db_all_filtered` names the wrong cause and the wrong remedy

Same repo, same DB, same clangd; only the spelling of the repo root differs:

| repo root | result |
|---|---|
| `C:/Users/ADMINI~1/...` (8.3 short form, matching the DB) | **ok**, 2/2 files processed |
| `C:/Users/Administrator/...` (long form) | **error `compile_db_all_filtered`** |

The error blames "the build/dep prefix rules" and its own message reports **`0 excluded, 0 unity`**
— nothing was filtered by the rules it names. The entries were dropped on an 8.3 short-name vs
long-name path mismatch. Its hint offers `--no-build-filter` or unity-build advice; **neither would
fix it**, so a reader following the remedy is sent away from the cause.

Field impact: on a Windows host where the compile DB records one path form and the caller supplies
the other, C++ code-intel collection fails with a diagnosis that cannot be acted on.

## ⛔ Defect 2 — the `file` column holds an MSVC include directory, not the source file

Verbatim from `code_intel_records`:

```
file="C:/Program Files/Microsoft Visual Studio/2022/Preview/VC/Tools/MSVC/14.43.34604/include"
  line=5  qname="alphaCaller"      id=c:cpp:src/callers.cpp:5:6
file="C:/Program Files/Microsoft Visual Studio/.../include"
  line=4  qname="Widget::render"   id=c:cpp:src/widgets.cpp:4:14
file="src/widgets.h"
  line=5  qname="alpha"            id=c:cpp:src/widgets.cpp:3:11
```

Four of six definition records carry a **compiler include directory** where a repo-relative source
path belongs. The remaining two hold `src/widgets.h` correctly, so the field's intent is not in
doubt. The `symbol_id` carries the correct source path throughout — the two disagree, and the
`file` column is the wrong one.

Site coverage against ground truth enumerated **before** consulting the records:

| site | kind | matched by `file`+line |
|---|---|---|
| `src/widgets.h:8` `alpha::Widget::render` | declaration | UNREPRESENTED |
| `src/widgets.h:15` `beta::Widget::render` | declaration | UNREPRESENTED |
| `src/widgets.cpp:4` `alpha::Widget::render` | definition | UNREPRESENTED |
| `src/widgets.cpp:8` `beta::Widget::render` | definition | UNREPRESENTED |
| `src/callers.cpp:5` `alphaCaller` | definition | UNREPRESENTED |
| `src/callers.cpp:10` `betaCaller` | definition | UNREPRESENTED |

**0 of 6 by `file`.** This is the preregistered site-mapping requirement failing: a compiler
identity must map back to the intended graph site rows by file and span, and by `file` it maps to
an MSVC toolchain directory. Any consumer joining code-intel records to graph nodes on path would
mis-attribute or find nothing, and a reader shown "definition at `…/MSVC/…/include:4`" is being
told something false.

⚠ **Read this precisely:** the sites are *not* absent. By `symbol_id` all six are addressed
correctly. The claim is that the **`file` column is wrong**, not that collection missed them.

### Where the fault is NOT — the path layer is exonerated

The stored `raw` payload carries the same wrong value, so this is the **provider's own output** at
record-construction time, not a storage or query artifact. `cpp-clangd.js` builds it as
`file: uriToRepoRelative(d.uri, projectRoot)`.

`uriToRepoRelativeSafe` was then tested directly, and it is **correct**:

| input | result |
|---|---|
| source URI, **long** root | `{"path":"src/callers.cpp","ok":true}` |
| source URI, **8.3 short** root | `{"path":"src/callers.cpp","ok":true}` |
| a genuine system header | `{"path":".../MSVC/14.43.34604/include/vector","ok":false,"reason":"outside_project_root"}` |

It already canonicalizes through realpath — `paths.js` documents this exact 8.3 bug from
2026-07-30 — and it handles a real system header by returning the full path **ending in a
filename**. The corrupted value ends at `/include` with **no filename at all**, which no file URI
produces.

⛔ **Therefore: do not "repair" `paths.js`.** It is not the defect, and changing it would break a
layer that is currently right. The fault is upstream — the URI the provider receives from, or
passes to, that call is already a directory.

⚠ **Mechanism NOT established.** Why clangd's definition response carries a directory URI while
its `range` is simultaneously *correct* (line 5, cols 6–17, exactly `alphaCaller`) is unexplained.
Establishing it requires capturing the raw LSP response, which has not been done. Everything above
is observation; the cause is open.

## ⚠ An instrument defect of mine, in the same run

My first coverage matcher compared **line numbers only** and reported `src/widgets.h:8` as
REPRESENTED on the strength of a `src/widgets.cpp:8` record that merely shared a line number. It
produced a confident, wrong, favourable answer. Corrected to match file **and** line, which is what
exposed defect 2. A matcher that ignores the field the claim is about cannot test the claim.

## Claim ceiling

Three source files, one fixture, one host, one clangd version, one compiler, one CMake generator.
These are claims about **this fixture under this toolchain** — not about C++ generally, not about a
real repository at scale (M5). Both defects are reproducible here; neither has been measured for
prevalence anywhere else.

## What this does not answer

C2's method-call binding question remains **out of scope and unanswered**, deliberately. It gets
its own preregistered replication. Nothing here licenses a claim about whether a compile database
changes `w.render()` edge binding.
