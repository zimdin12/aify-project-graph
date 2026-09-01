# Defect 2 — boundary capture: **the wire is already wrong**

Contract (frozen first): `CONTRACT-lsp-location.md` · Receipts: `receipts/boundary-capture.jsonl`
(76 records, sha256 `c0e4c322…`), `receipts/boundary-canary.txt`

Four boundaries captured on the **real provider path** — `buildClangdSpawn`, the provider's own
args and environment — with raw JSON-RPC intercepted inside `LspClient` transport before
`rewriteUris` / `canonicalUri` / any semantic rewrite.

| stage | records |
|---|---|
| 1a outbound raw frame (after framing, before write) | 29 |
| 1b inbound raw frame (after Content-Length decode, **before** rewrite) | 35 |
| 2 post-`LspClient` object handed to `cpp-clangd` | 6 |
| 3 provider-constructed record | 6 |

**Probe liveness was mechanical, not assumed:** 2 load-time canaries present, 0 write failures,
unfiltered stderr captured, process exit recorded.

## The first divergence is at the wire

Raw inbound frames, verbatim:

```
id=3  result: [ { range:{start:{line:4,character:5}, end:{line:4,character:16}},
                  uri:"file:///C:/Program%20Files/.../MSVC/14.43.34604/include" } ]

id=6  result: [ { range:{...same...}, uri:".../apg-clangd-qual/src/callers.cpp" },
                { range:{...same...}, uri:"file:///C:/Program%20Files/.../MSVC/14.43.34604/include" } ]
```

**clangd itself returns a directory URI carrying a character-precise identifier range** — line 4,
columns 5–16, exactly `alphaCaller`. The frozen contract declares that state **invalid by
construction**, and it was declared before this payload was seen.

Two distinct shapes appear: sometimes the directory URI is the **only** result (`id=3`); sometimes
it is an **extra second** location beside the correct one (`id=6`).

## Localization, by the rule fixed in advance

| rule | verdict |
|---|---|
| wire wrong → clangd / request / compile-DB side | ✅ **this one** |
| wire right, client object wrong → `LspClient` decoding | ruled out |
| both right, stored record wrong → `cpp-clangd` construction | ruled out |

`uriToRepoRelative` received the directory URI and handled it **correctly** — returning the
absolute path with `ok:false`, which is the right answer for something outside the project root.
The provider then faithfully recorded what it was given. Neither layer invented anything.

⛔ **So three tempting repairs are all wrong:** patching `paths.js`, reconstructing `file` from
`symbol_id`, and "fixing" the record constructor. Every one of them would paper over a producer
that is emitting a location no consumer can honour.

## ⛔ A hypothesis of mine, falsified in the same pass

The provider passes `--query-driver=*`; my earlier standalone probe did not, and got a correct
response. `resolve-clangd.js:238` documents the flag as *"Harmless on native DBs (clangd only
queries drivers actually referenced)"*. The MSVC include directory is exactly what query-driver
discovers, so the flag looked like the cause.

**It is not.** Same clangd, same compile DB, same file, same position, only the flag varying:

| arm | directory-shaped URIs |
|---|---|
| **with** `--query-driver=*` | 0 |
| **without** (control) | 0 |

Both returned the single correct `src/callers.cpp` location. The flag is **not sufficient** to
reproduce the defect on this fixture, and I am not asserting it as the cause. Recorded because a
plausible, well-motivated, documented-sounding hypothesis that survives one confirming observation
is exactly what gets shipped as a root cause.

## What remains open

The provider run and my standalone run differ in more than the flag: `BASE_CLANGD_ARGS`, the MSVC
environment injected by `msvc-env.js` (the `INCLUDE` variable), which files are opened, and request
ordering. **Which of those triggers it is not established.** Naming one now would be a story, not a
cause.

## Claim ceiling

One fixture, one host, one clangd version, one compile DB, one CMake generator. The wire-level
localization is solid for **this** run; prevalence is unmeasured. Nothing here says how often real
repositories hit it, and nothing here licenses a repair to any layer downstream of the producer.

---

## Six candidate causes falsified, with controls

The provider reproduces the directory URI reliably — 6 of 6 definition records, across two separate
runs. A standalone harness driving the same `LspClient` **never** reproduces it. Each difference
between them was eliminated one variable at a time:

| # | hypothesis | result |
|---|---|---|
| 1 | `--query-driver=*` (provider passes it, harness did not) | **falsified** — 0 directory URIs with it, 0 without |
| 2 | provider `BASE_CLANGD_ARGS` (`--background-index`, `-j=4`, `--pch-storage`, `--limit-results`) | **falsified** — clean with the full set |
| 3 | opening all files vs one | **falsified** — clean both ways |
| 4 | background-index warmth / timing | **falsified** — 8 polls at `indexingState=ready`, all clean |
| 5 | request position | **falsified** — the provider's captured `requestPos` is `{line:4,character:5}`, identical to the clean harness |
| 6 | the compile DB consumed (source vs normalized) | **falsified** — clean against both directories |

`--query-driver=*` was the most attractive of these: the corrupt URI *is* an MSVC include directory,
which is exactly what query-driver discovers, and `resolve-clangd.js:238` documents the flag as
"harmless on native DBs". It looked like a root cause and is not one.

**Still untested:** the child environment from `clangdChildEnv()` and the working directory. The
mechanism is **not established**, and naming one of these now would be a story.

Six falsified hypotheses is not a cause, but it is not nothing: it forecloses six wrong repairs,
including the one that reads best in a commit message.

## ⚠ A receipt of mine described the wrong artifact

I preserved `build/compile_commands.json` as the "as-consumed" DB. **clangd never read it.** The
provider calls `prepareCompileDb`, which writes a normalized copy to
`.aify-graph/code-intel/compile_commands.json`, and points `--compile-commands-dir` there:

| file | sha256 |
|---|---|
| normalized — what clangd actually read | `29412468d4cb3920…` |
| source — what I preserved and labelled "as consumed" | `8d5becad63056153…` |

The stored records carry `freshness: "compile_db_hash:29412468d4cb3920"`. **The record named the DB
it consumed, in a field I was already reading, and I preserved a different file anyway.** Both are
now kept, named for what they are. The earlier receipt is renamed rather than deleted, because a
receipt that described the wrong artifact is itself part of the record.
