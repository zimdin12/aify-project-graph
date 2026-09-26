# Path normalisation: three more ways Windows can alias a path, measured

**Date:** 2026-09-26. **Subject:** `mcp/stdio/freshness/path-exists.js` as of `ab42bdc4`.
**Reproduce:** `node docs/evidence/ref-conservation-2026-09-25/path-normalisation-probe.mjs`
(add `--unfixed` for the broken-subject run). Outputs in `path-normalisation-output.txt` and
`path-normalisation-unfixed-output.txt` are that script's own stdout.

## Why

The defect `27c5c422` fixed was: `existsSync` is case-insensitive on Windows, so it answered PRESENT
for a path no directory listing contains, and the orchestrator skipped deleting stale nodes. The fix
compares each path segment against `readdirSync`.

dashboard-manager pointed out that case is not the only aliasing Windows does, and named two shapes
it had **not** measured: trailing dots / spaces, and 8.3 short names. Both would produce the same
shape of defect. An unmeasured pointer is not a finding, so this measures it. The pointer was offered
without a claim attached, and that is how it is recorded here.

## Result

| vector | `existsSync` | `existsWithExactCase` | verdict |
|---|---|---|---|
| `src/middle.js` (positive control) | true | **true** | instrument can say PRESENT |
| `src/nope.js` (negative control) | false | **false** | instrument can say ABSENT |
| `src/MIDDLE.js` — wrong case | true | **false** | the known defect, still rejected |
| `src/middle.js.` — trailing dot | **false** | false | does not fire on this platform |
| `src/middle.js ` — trailing space | **false** | false | does not fire on this platform |
| `LONGDI~1/f.js` — 8.3 short name | **true** | **false** | fires in `existsSync`, rejected by the fix |

**No change to the product was needed.** The segment walk already rejects all three, because it
compares against a directory listing rather than asking the filesystem to resolve a name. That is a
property of the approach, not a coincidence — any alias the filesystem resolves is still absent from
the listing.

## The two controls that make the table worth reading

**ARM 2 — input integrity.** `path.join` normalises, so a probe for `src/middle.js.` can silently
become a probe for `src/middle.js`, return a clean FALSE, and read exactly like "the vector does not
fire". ARM 2 prints the bytes `join` produced and cross-checks against a path built without `join`.
Both trailing-suffix rows above are only meaningful because ARM 2 shows the suffix survived.

**The broken-subject differential.** A clean run against the fixed helper proves nothing on its own:
it looks identical whether the vectors are absent or the probe is blind. `--unfixed` swaps in the
bare `existsSync` the defect shipped with and runs the *same* instrument:

```
HELPER UNDER TEST: bare existsSync  [--unfixed: the BROKEN subject]
  FAILURE: "src/MIDDLE.js" expected false, got true
  FAILURE: "LONGDI~1/f.js" expected false, got true
VERDICT: 2 FAILURE(S)                                    exit 1
```

It fails on **exactly** the two alias rows and nothing else, and ARM 3 passes under both subjects. A
probe that went red everywhere would be an instrument defect, not a finding.

## ARM 3 is the arm worth keeping, and it tests the opposite direction

The obvious risk is an alias being accepted. The *dangerous* one is a live file being denied:
`existsWithExactCase` keeps `existsSync` as a fast path to FALSE, and the caller's response to
"absent" is `deleteNodesForFile`. A wrong FALSE destroys real data.

This filesystem **does** accept `dot.js.` and `space.js ` as real names — `readdir` lists them. So
the question is live, not hypothetical. Measured: `existsSync` is exact in both directions for those
names, so a genuinely-named `dot.js.` is reported present and its nodes survive. Zero failures.

## Limits

- **One platform, one filesystem.** Windows 11, NTFS, 8.3 generation enabled on this volume (the
  `LONGDI~1` row is evidence it was enabled — on a volume with it disabled that row would read
  `existsSync=false` and the vector would be unreachable rather than handled).
- The probe covers the helper, not every call site. The four decision points in
  `orchestrator.js` are covered by `tests/unit/freshness/path-exists.test.js` and the rename audit.
- Trailing dot and space **not firing** is a fact about this platform's resolution, not a guarantee
  about every Windows configuration. The fix does not depend on it either way: the segment walk
  rejects the alias whether or not `existsSync` accepts it.
