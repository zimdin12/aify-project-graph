# Receipt binding — suite-c757a32-GREEN-pushed.txt

⚠ Interpretation lives HERE, never appended to the capture. The raw log is byte-preserved; an
earlier point in this arc appended interpretation to a receipt twice and had to restore it.

| field | value |
|---|---|
| subject commit | `c757a3233eefae5a408f8c022ef9755de4708b77` |
| tree state at run | clean (no untracked, no modified) |
| VITEST_EXIT | **0** (read from the log at line 1077, not from the harness notification) |
| raw receipt | `suite-c757a32-GREEN-pushed.txt` |
| raw receipt sha256 | `baa85d0cbb244a5b9734c9ddb519600494f5f5ea1765b89b5d5fcd83fc711470` |
| test files | 422 passed |
| tests | 3547 passed, 4 skipped |
| failed assertion lines | 0 |
| duration | 614.04 s |

## Why the exit code is read from the log

The harness notification reported "exit code 0" for a suite that exited **1** twice in this
session. Only `VITEST_EXIT`, captured into the log via `PIPESTATUS[0]`, is authoritative here.

## What this receipt certifies — and what it does not

**Certifies:** the full suite passes on exactly `c757a32`.

**Does NOT certify:**
- the shared `lsp-collect` admission path, which remains unguarded and explicitly open;
- any latency or reliability claim for the document snapshot — the A/B timing was inconclusive and
  its sample biased by conditioning on success;
- that the load-sensitive budget-limited integration test is a reliable gate. It failed in **both**
  A/B arms (3/6 and 1/6) and that gate remains open;
- the snapshot access-partition reconciliation, which is outstanding: `2 reads + 2049 hits = 2051`
  accesses is a different population from `2001` retained records, and the equality control is not
  yet written.
