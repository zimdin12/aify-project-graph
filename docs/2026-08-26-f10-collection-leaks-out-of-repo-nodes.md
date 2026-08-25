# F10 — Python collection imports out-of-repo nodes as raw `file://` URIs

**Found by following the review's own instruction on F5: enumerate the population before calling
anything a defect.** Typing the residual orphans turned up something that was not an orphan problem
at all.

## The finding

`click`'s graph contains six nodes whose `file_path` is a percent-encoded `file://` URI pointing
**outside the repository being analysed**:

    file:///c%3A/Users/Administrator/AppData/Roaming/Python/Python314/site-packages/click/core.py
    file:///c%3A/Users/Administrator/AppData/Roaming/Python/Python314/site-packages/click/decorators.py
    file:///c%3A/Docker/aify-project-graph/node_modules/pyright/dist/typeshed-fallback/stdlib/types.pyi

Two distinct leaks:

- **site-packages.** pyright resolved `click` to the operator's **installed** copy rather than the
  checked-out source. The graph therefore describes a different copy of the library — possibly a
  different version — than the repository the agent is working in.
- **our own `node_modules`.** pyright's bundled typeshed stubs, read out of the aify-project-graph
  installation directory, imported into a third-party project's graph.

## Cause, with a negative control across five graphs

    click        collect WAS run     6 file:// nodes of 2,572
    fmt          no collect          0 of 6,735
    fast-route   no collect          0 of   489
    p-queue      no collect          0 of   184
    aify-project-graph (our own)     0 of 6,700

⇒ **Collection produces it; indexing does not.** One arm differs in exactly one way and it is the
arm that ran `graph_collect_code_intel`.

⚠ **And that control also explains why it was never caught.** Our own repository shows zero because
we collect JavaScript there, so pyright never runs. The defect is invisible on the only corpus this
project has ever measured itself against.

## Why it matters to a reader

1. **A location an agent cannot use.** Every other node carries a repo-relative path. These carry a
   URI, so a consumer doing ordinary path work gets something it cannot open, and an agent told a
   symbol is "defined at `file:///c%3A/...`" is being pointed out of its own working tree.
2. **A different copy of the code.** A site-packages hit is not the source under edit. Acting on it
   — reading it, reasoning about its contents, editing near it — operates on the wrong file.
3. **Invisible to git-based coverage.** These paths are not tracked files, so every coverage figure
   computed against `git ls-files` silently excludes them. The graph is contaminated in the
   numerator while the denominator never learns of it.

⚠ Six nodes in a small repository. The count is not the finding — the SHAPE is, and nothing
currently bounds it.

## What this is NOT

- **Not an orphan defect.** It surfaced through the orphan enumeration, but the orphaned `Symbol`
  nodes themselves are benign: `command`, `prompt`, `progressbar` and `edit` each sit beside
  well-connected Function/Method nodes (167, 65, 25 and 40 edges respectively). Click's public API
  is richly connected. Those Symbol duplicates are noise, not loss, and calling them a miss would
  have been wrong.
- **Not measured beyond Python.** Only the Python arm ran a collection. Whether the TypeScript or
  C++ providers leak the same way is untested and must not be assumed either way.
- **Not diagnosed to a line.** The import path that admits these nodes has not been located. This
  records the observation and its cause boundary, not the repair.

⇒ Related prior art in this repository: `uriToRel` discarding its `ok` flag and putting a directory
in a `file` field, and `tests/unit/query/out-of-repo-locations.test.js`. Out-of-repo leakage is a
known class here — evidently closed for the live verbs and open on the collection-import path.
