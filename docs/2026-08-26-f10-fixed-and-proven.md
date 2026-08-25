# F10 — fixed, and proven on the graph that exhibited it

## The result

    baseline, fresh graph before collection    0 file:// nodes of 2,393
    after collection WITH the fix              0 file:// nodes of 2,566
    outOfRepoSkipped                          12

⭐ **The 12 is what makes the 0 mean anything.** It proves pyright DID resolve outside the
repository twelve times during that run — the exact conditions that produced the leak — and that
none of them was recorded. A zero beside a zero would have been indistinguishable from "the language
server happened not to leave the repo this time", which proves nothing about the fix.

⚠ The first verification attempt could not have shown either outcome: I re-collected over the
EXISTING graph, where the six nodes imported by the earlier run necessarily survive because
collection adds and never deletes. The graph had to be rebuilt from scratch for the question to be
answerable at all.

## The defect

`mcp/stdio/code-intel/providers/lsp-collect.js`, one line:

    try { return toRepoRelative(uri, realRoot); } catch { return uri; }

Arguments REVERSED — the signature is `toRepoRelative(projectRoot, filePath)` — so it always threw,
with an error naming the repo root as the path and the URI as the root. And the catch returned its
own input, writing a raw percent-encoded `file://` URI into `file_path`.

The containment check above it was always correct. What followed converted a correct refusal into a
stored artifact.

## The repair

- `relativizeUri` returns `null` for out-of-repo targets, making the case unignorable at every call
  site rather than silently recordable.
- The reversed fallback is DELETED, not corrected: with the arguments the right way round it throws
  for exactly the same inputs, so it could only ever succeed where the check above it already had.
  It existed solely to produce the wrong answer.
- All three call sites skip and COUNT. Replacing a wrong answer with an unexplained gap is its own
  defect; `outOfRepoSkipped` travels with the collection so a reader sees the caller set is a floor
  for a NAMED reason.
- The dead `toRepoRelative` import went with it.

## ⛔ Three self-inflicted detours, all one shape

1. **Verified against a graph that could not answer.** Re-collecting over existing data, where the
   old leaked nodes survive by construction.
2. **Added the counter where no caller could see it.** It reached the provider's session and never
   the verb's response — the count existed, nobody could read it. That is the same
   unreachable-to-the-consumer defect this audit keeps finding, committed inside the fix for another
   instance of it, and the third time today.
3. **The comment ten lines below described the bug exactly** — reversed arguments, a `file://` URI
   where a path was expected — in a copy deleted for being a trap, while the live one stood. It even
   explained why the dead copy was harmless: *"it was never called."*

⇒ Every one is "I checked the thing I built, not the thing a consumer receives." The questions "does
it work?" and "can the caller see it?" are different, and only the first has an obvious test.
