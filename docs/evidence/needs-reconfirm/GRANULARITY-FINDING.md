# M3b prerequisite: per-file fingerprints cannot carry `needs_reconfirm`

**Checked before building, as the plan required. The answer is no, on measured grounds.**

## The gap M3b was meant to close

We detect anchors that **broke** — a feature's symbol or file is gone, and `validateAnchors`
reports it. We never detect a claim that went **out of date**: a feature whose anchored files were
edited but still resolve is reported as valid, even if the edit changed what the code does.

The plan proposed using the structural fingerprints already stored in the graph, and required
checking their granularity first, because per-file would produce too many false reconfirms.

## Measured

```
structural_fingerprints:  file_path TEXT PRIMARY KEY, fingerprint TEXT
live graph:               301 rows, 301 distinct file_path  => PER-FILE
```

Symbol density on the same graph:

```
files with symbols   632
symbols              2742
mean per file        4.3
median per file      3
worst                lsp-client.js 49, compile-db.js 43, packet-lists.js 38
```

**P(an edit in a file is unrelated to a given anchored symbol in that file) = 52.9% mean.**

So a per-file fingerprint would raise a false reconfirm **more than half the time**. A feature
anchoring one symbol would be flagged whenever anyone touched any of the other ~3 symbols beside it.

## Why that disqualifies it rather than merely weakening it

A signal wrong 53% of the time is not a weak signal, it is an anti-signal: it trains the reader to
dismiss it, and the dismissal generalises to the cases where it is right. This is the exact
desensitisation failure a field agent named about our existing caveats — *"the identical block
whether or not it bears on the decision ... trains me to skim it in the one case where it decides
everything."* Shipping a 53%-wrong reconfirm flag would manufacture a second instance of the
defect we are trying to remove.

## Options, with the trade-off

1. **Per-symbol fingerprints.** Hash the anchored symbol's own span rather than its file. Precise,
   and a schema change plus an extractor change — the largest of the three.
2. **Anchor-scoped hashing at read time.** Keep the table as-is; when validating an anchor, hash
   only the symbol's line span from the working tree. No schema change, cost paid per validation,
   and it needs the symbol's span to be reliable.
3. **Drop M3b.** The gap stays open and we say so.

**Recommendation: (2), reversible.** It needs no migration, and if span reliability proves too weak
the fallback to (1) is a schema addition rather than a rewrite. (3) stays honest if (2) measures
badly.

## What would make us stop

If anchor-scoped hashing cannot get the false-reconfirm rate under ~10% on this repo, the feature
does not ship — a reconfirm prompt an agent learns to ignore is worse than no prompt.
