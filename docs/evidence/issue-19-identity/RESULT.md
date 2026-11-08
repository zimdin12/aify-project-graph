# #19 step 1: one stableId, one nodeText — node and edge ids unchanged

`node docs/evidence/issue-19-identity/probe.mjs <apg-checkout> <scratch-parent> <label>` copies `tests/fixtures`
(without `.aify-graph`) into a scratch git repository, indexes it with `bin/apg.js index`, and prints the count and a
sha256 prefix of the sorted node ids and of the sorted (from, relation, to) edges.

| run | code | nodes | idset | edges | edgeset |
|---|---|---|---|---|---|
| before | 980a1289 | 482 | 3d816a24f64241f6 | 535 | a52a54c2b4d5d7ac |
| before-repeat (determinism control) | 980a1289 | 482 | 3d816a24f64241f6 | 535 | a52a54c2b4d5d7ac |
| after | this commit | 482 | 3d816a24f64241f6 | 535 | a52a54c2b4d5d7ac |
| mutant: `join(':')` (sensitivity control) | this commit, mutated | 482 | 70f4d76d8a88ba45 | 535 | 3e9d8b57a0910a62 |

Run 2026-11-08 on Windows, Node 22.20.0. The fixture set is this repo's own; it is not a sample of real repositories.
