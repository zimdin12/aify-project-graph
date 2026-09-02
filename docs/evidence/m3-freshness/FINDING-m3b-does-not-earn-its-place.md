# FINDING — M3b as specified does not earn its place on the substrate that exists

The plan holds M3b behind two preconditions:

> (a) M1 identity — ✅ **SHIPPED**
> (b) a persisted per-anchor confirmation lineage — **NOT built, and the remaining blocker**

Measuring (b)'s substrate first changed the question. This is the disposition, not a request.

## The three facts, all measured

1. **Granularity is per-FILE.** `structural_fingerprints` is keyed `file_path PRIMARY KEY`,
   838 rows. There is no per-symbol fingerprint anywhere.
2. **Spread**: median 3 symbols per file, mean 4.3, p90 9, max 49 (695 files, 3,012 symbols).
3. **It is body-blind BY DESIGN.** `ingest/fingerprint.js` hashes symbol shapes plus the outgoing
   ref set and excludes bodies — its own header says a body-only/comment/whitespace/literal edit
   leaves the hash UNCHANGED.

## What that means for a reconfirm signal

Even with (b) built, the signal would be:

- **Structural claims** ("X has these callers", "nothing calls X") — detectable, but a file-level
  trigger wakes every claim in the file. At the mean that is ~4.3 claims per real change.
- **Behavioural claims** ("X validates its input", "X returns null on failure") — **undetectable at
  any granularity**, because the insensitivity is to BODIES, not to scope. A finer fingerprint does
  not help. Flipping a comparison or changing a constant moves nothing unless a call changes.

⚠ **The ~77% figure is a MODEL, not a measurement.** It follows from the mean symbols-per-file
under an assumption of uniform edit distribution. Nothing here measured how often claims actually go
stale, or how reconfirms would distribute over real edits. It is an order-of-magnitude argument and
is labelled as one — this project has retracted a model-derived proxy presented as an observed rate
before (`GRANULARITY-FINDING.md`'s 52.9%).

## The purpose test, applied

> Does this make an agent's decision better, faster or safer than grep alone? If not, it does not
> ship.

A reconfirm signal that fires several times per real change **and** misses the most common way a
behavioural claim goes stale does not pass. Worse, it fails in the direction this project has
already been burned by: a caveat that fires too often trains its reader to skim, and the 445-byte
warning wall had to be torn out for exactly that. **A noisy freshness signal is not a weak feature;
it is a feature that degrades the signals around it.**

## Disposition

⛔ **M3b as specified is NOT worth building on this substrate.** Three honest options, and the
choice between them is a scope call rather than a design one:

1. **Scope M3b to STRUCTURAL claims only**, state the file-level granularity in the output, and
   accept that a reconfirm means "something in this file changed". Cheapest; delivers the smaller
   half honestly.
2. **Find a substrate that can see behaviour** — test outcomes, review evidence, or the "proven
   equivalence" authority step C was always for. That is a new milestone, not a lineage schema.
3. **Drop M3b** and keep the gap stated, which is what the plan already does.

⇒ My recommendation is **(1) or (3)**, not (2) — (2) is a research project wearing a feature's
clothes, and the plan's own stop condition says to name that rather than keep building.

⚠ What this does NOT establish: that claims go stale often enough to matter at all. Nobody has
measured that, and it is the question that should decide between (1) and (3). It is the same
missing measurement M5 exists to supply — whether any of this changes an agent's decision at scale.
