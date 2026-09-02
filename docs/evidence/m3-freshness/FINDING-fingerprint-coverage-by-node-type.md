# M3b: the file-level trigger is an assumption, and one node type has no fingerprint at all

**Date:** 2026-09-03
**Status:** two corrections to `FINDING-m3b-does-not-earn-its-place.md`. Neither overturns its
conclusion; one weakens a leg of the argument, the other adds a limitation it does not mention.

---

## What was claimed

`FINDING-m3b-does-not-earn-its-place.md` disposes of M3b on two legs:

1. **Granularity.** "A **file-level trigger** wakes every claim in the file. At the mean that is
   ~4.3 claims per real change" — from which the ~77% false-reconfirm model follows.
2. **Behaviour.** Behavioural claims are "undetectable at **any** granularity", because
   `structuralFingerprint` excludes bodies. A finer fingerprint does not help.

Leg 2 is untouched by anything below and stands on its own.

---

## Correction 1 — the file-level trigger is not forced by the substrate

The document asserts a file-level trigger. It does not establish that file level is the only
granularity available, and two facts say it is not:

- **Per-symbol structural fingerprints are stored.** `nodes.structural_fp` is a real column, written
  during extraction at `mcp/stdio/ingest/extractors/generic.js:311`
  (`node.structural_fp = structuralFingerprint(structuralInput)`).
- **An incremental index already re-parses changed files.** So at index time both the stored
  per-symbol fingerprint and the freshly extracted one are in hand. Comparing them per symbol costs
  no extra parse.

A file-level trigger would be forced only if the reconfirm had to run *without* parsing. Nothing in
the disposition says it must.

⇒ The ~77% model is derived from an assumption the substrate does not impose. It was already
labelled a MODEL rather than a measurement; this narrows further what it rests on.

⚠ **CEILING.** This establishes that the INPUTS for symbol-granular comparison exist. It does not
measure a false-reconfirm rate at any granularity, does not show a symbol-granular comparison is
correct, and does not show M3b earns its place. Leg 2 alone may still be sufficient to drop it.

---

## Correction 2 — every LSP-imported symbol has no fingerprint

Coverage is not uniform. Measured on this repo's graph (6,863 nodes):

| type | total | no `structural_fp` |
|---|---:|---:|
| Function | 2916 | 0 |
| Module | 885 | 0 |
| Document | 365 | 0 |
| Method | 137 | 0 |
| Config | 131 | 0 |
| Class | 49 | 0 |
| Directory / Entrypoint / Test / ShaderBinding | 289 | 0 |
| **File** | 903 | **34** |
| **External** | 776 | **776** |
| **Symbol** | **412** | **412** |

- **Function + Method + Class — the declaration types a structural claim is about — are 100%
  covered (3102/3102.)** That is the population a structural reconfirm would target.
- **External (776/776 missing) is correct**, not a gap: an external stub has no source in this repo
  to fingerprint.
- **`Symbol` (412/412 missing) is a real exclusion.** `Symbol` nodes are created ONLY by
  `mcp/stdio/ingest/code-intel/importer.js`, at three sites (lines 111, 166, 444), and every one
  writes `structural_fp: ''`.

⇒ A structural reconfirm keyed on `structural_fp` would work fully for tree-sitter-extracted code
and **silently exclude every symbol that arrived through the code-intel path** — the clangd trust
spine, which is the C++ population this project cares most about. That is the shape this repo has
shipped before and had to find in the field: a feature that measures zero on the deployment that
matters. Found here before building anything.

⚠ **CEILING.** This establishes that `Symbol` nodes carry no fingerprint and where they come from.
It does NOT establish that the exclusion bites: whether a claim would ever be anchored to a `Symbol`
node, rather than to the `Function`/`Method` node covering the same code, is unmeasured. If claims
anchor to the tree-sitter nodes, the exclusion may be harmless.

The 34 File nodes without a fingerprint are noted, not chased: a structural claim is about a symbol,
not a file.

---

## How this was found, including the part I got wrong

⛔ **My first conclusion was the opposite, and it was wrong.** Grepping for `symbolFingerprints`
returned only its own definition, and I drafted a finding that per-symbol fingerprints are never
computed — the "declared but inert" pattern. One `SELECT` against the real graph refuted it: 5,641
nodes carry a populated fingerprint, written by `structuralFingerprint`, a function whose name
differs from the one I searched.

★ The artifact check cost one command and killed a finding I had already written down. A grep for a
plausible name is a pointer to check, never the check itself — and searching for the WRONG name
returns a clean, confident zero that looks exactly like a real absence.

⚠ The aggregate I reported first ("82% populated") was also the wrong noun. It mixes External stubs
that correctly have none with a real exclusion, and it hides that the population that matters is at
100%. The per-type breakdown says something the aggregate actively obscured.

---

## What would change the disposition

Only a measurement, and the cheapest one is available from this repo's own history: for each recent
commit, compare which symbols' structural fingerprints actually changed against which claims a
trigger would have woken, at each granularity. That converts the ~77% model into an observed rate.
It has not been run.

Until it is, the recommendation in `FINDING-m3b-does-not-earn-its-place.md` stands on leg 2 alone —
which is the leg that never depended on granularity.
