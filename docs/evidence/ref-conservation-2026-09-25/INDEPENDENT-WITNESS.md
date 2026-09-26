# Independent bounded reference-conservation witnesses

These are **byte-for-byte archived** scripts and raw output from graph-senior-dev's isolated checks on 2026-09-26. They are separate from the graph owner's reproducer and tests. The scripts were originally run from the Hermes scratch directory; their hard-coded checkout paths are historical run inputs, **not durable dependencies**. To rerun, copy a script, replace its checkout-path constants with checkouts at the commits below, supply a compatible `better-sqlite3`/Node installation, and run the copy. Do not modify the archived script or substitute newly generated output for this original receipt.

| Artifact | SHA-256 |
| --- | --- |
| `independent-unfixed-871a1d65.mjs` | `13a91982e30c6a00cade9bde6fe77c4358d1640bb7f52e4cd93ea9443648bea0` |
| `independent-unfixed-871a1d65.output.txt` | `fb904f473ed70435b775e5182eaa1ccdbd0e6a40a95a2f32ed018d45a37b2f65` |
| `independent-paired-72996bce.mjs` | `4aecd1137646dd0838642e2e743b9898e76ccae9269817e5dfdbe7be9c32b8d8` |
| `independent-paired-72996bce.output.txt` | `5d6313a70bf5ad8f61da44e63b4303a521c1ba80c060719e2782bcda795da3a4` |

The first script used an unmodified checkout at APG `871a1d6548eaf08c464557e279ce9ae8b1b56122`. It checks eight *specific* extractor-emitted refs in five JavaScript files: `outerA/B/C.js → middle.js → inner.js`, one File IMPORTS and one symbol CALLS per source file. After changing only `inner.js`, the incremental graph held 2/8; a full rebuild of the identical final Git tree held 8/8. Both the indexed commit and new `innerTwo` node confirmed the edit was processed. Deleting one known-good edge in a disposable rebuild changed exactly that ref to LOST (7/8). Six emitted refs had neither an edge nor an `unresolved_refs` entry in the incremental graph.

The second script runs the same fixture in **one Node process**, with distinct disposable graph DBs for the fixed and reverted arms, identical baseline and edited Git trees, and the same full-rebuild and planted-loss controls. Fixed source was APG `72996bce49b95f530b5d32396558410199efcbfb` (orchestrator blob `55d4b6d2`); reverted source was the exact pre-fix orchestrator blob `835e97a5` from its parent, not a rewritten approximation. Outside that orchestrator, `mcp/stdio` and package files did not differ between the two pinned checkouts. Baselines were 8/8; after the edit, fixed 8/8, reverted 2/8, full rebuild 8/8, and the planted-loss arm 7/8. Both incremental generations advanced 1→2 and contained `innerTwo`.

**Limits:** eight named refs in one synthetic history, not all emitted refs or a general absence certificate. This proves the mechanism and its bounded repair on this fixture; it does **not** attribute the nine historically missing IMPORTS to this mechanism, repair old indexes, or prove that a full rebuild is sufficient for exhaustive caller answers. A local evidence-branch commit preserves these bytes in Git; it is not a push, a release, or integration into `main`.
