# orphaned-ledger-sand-castle-2026-08-20.json

A real `collect-progress.json` resume ledger, captured in the wild in the orphaned state, not
constructed. Kept byte-exact — see "Why no header inside the JSON" below.

## Where it came from

`C:/Users/Administrator/sand_castle/.aify-graph/code-intel/collect-progress.json`, copied
2026-08-20 immediately before it was cleared by hand. Captured in field testing during the field
round that found the defect; sand_castle is not this project's repo, and the copy was taken with
this project's authorisation. Nothing of ours was left behind there.

## The state it captures

The ledger claims 200 collected files. The graph database it makes those claims about had been
rebuilt by `graph_index(force=true)` hours earlier, destroying every `LSP_VERIFIED` edge the
claims refer to — the provenance census at capture time was EXTRACTED / INFERRED / AMBIGUOUS only,
zero LSP_VERIFIED, confirmed by `GROUP BY provenance` rather than a probe.

`dbHash` still matched, because it hashes the COMPILE database (`compile_commands.json`,
untouched) and not the graph database. So `readLedger` honoured all 200 claims, `pendingFiles`
subtracted them from the enumeration, the collect loop had nothing to walk, and the response
reported `index.filesTotal: 0` — the documented completion signal — alongside
`reason: "enumeration_capped_at_200_of_267"` in the same payload. Two calls returned byte-identical
results: a fixed point that reports success.

The consequence worth preserving: the remedy the tool itself prints for this state
("Run graph_collect_code_intel to restore it") could not execute, and no field in the response
distinguished that from a genuine convergence.

## How it compares to the synthetic fixture in collect-ledger-orphaned.test.js

Checked at capture time. Structurally faithful in every respect `readLedger` touches:

| | synthetic | this artifact |
|---|---|---|
| top-level keys | version, dbHash, collected, updatedAt | identical set |
| `version` | 1 | 1 |
| `collected` | 2 entries | 200 entries |
| path form | relative, POSIX separators | relative, POSIX separators — 0 absolute, 0 backslashes, 0 duplicates |
| `dbHash` | `'HASH1'` | `'c39e8157e3a56323'` (16 hex) |

Only scale and hash spelling differ, and neither is load-bearing: `readLedger` compares `dbHash`
by equality and reads `collected` as an array. The synthetic fixture did not turn out to be
easier to satisfy than production. The one latent difference: `'HASH1'` is not hash-shaped, so a
future check that validates hash FORM would pass on the synthetic and might not on real data.

## Why no header inside the JSON

The value of this file is that it is exactly what production wrote. Adding a `_comment` key would
make it something production never produces, which is the property that makes a wild capture worth
more than a construction. Provenance lives here instead.
