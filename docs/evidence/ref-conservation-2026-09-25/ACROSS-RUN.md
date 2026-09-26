# Conservation of refs ACROSS an incremental run

`scripts/audit-ref-conservation-across-run.mjs`, run at `8eb6b65b`. Raw output: `across-run-output.txt`.

## What this answers that the point-in-time check cannot

`scripts/audit-ref-conservation.mjs` asks whether the graph, right now, holds every ref the extractor
emits. Its own limit 3 says why that cannot certify preservation across a run: **an index that went
quiet conserves refs perfectly, because nothing changed them.** A quiet index and a correct one produce
the same reading, and the quiet one looks better.

This one takes a before and an after. The difficulty is not detecting that a ref is gone. It is deciding
**why**, because there are two reasons and only one is a defect:

| verdict | meaning | is it a defect |
|---|---|---|
| `SURVIVED` | recorded before, recorded after | no |
| `REMOVED_AT_SOURCE` | the file no longer emits it — someone deleted the call | **no** |
| `LOST` | the file still emits it, and the graph holds neither an edge nor an `unresolved_refs` row | **yes** |

⭐ **The discriminator is the extractor, not a second graph.** Re-extract the source after the run and
ask whether it still emits the ref. Extraction is upstream of both graphs, so this needs no oracle that
has not itself been checked — the same reasoning that made the point-in-time check prefer extraction
output over a forced rebuild.

## The arms, and why ARM A is the one that matters

Each arm carries its own action, positive and negative controls **in its own run**, because a quiet arm
and a correct arm read identically.

| arm | what it plants | must report | result |
|---|---|---|---|
| A | `outerA.js` stops importing and calling `middle` | **nothing** | PASSES, 0 lost, 2 removed-at-source |
| B | a surviving `CALLS` edge deleted from storage | the ref, by name | PASSES, names `src/outerB.js CALLS middle` |
| C | a surviving `IMPORTS` edge deleted from storage | the ref, by name | PASSES, names `src/outerC.js IMPORTS src/middle.js` |

**ARM A is the half that determines whether anyone ever uses the result.** A check that reports a
legitimate removal as a loss produces findings that are wrong, and a reader who has dismissed three
wrong findings will dismiss the fourth without reading it — which is how a real loss gets ignored by a
working instrument. The rule set before the first run was that if ARM A could not pass cleanly, this
script would be reported as decoration rather than tuned until it passed. (Framing: dashboard-manager.)

**Pre-registered, before any result existed:** if a planted drop did not produce a refusal naming file,
relation and target, the check is decoration. Not "mostly works".

### Every arm has been watched failing

Two complementary mutations of the classifier, each run in full:

| mutation | A | B | C |
|---|---|---|---|
| can never say `LOST` | PASS | **FAIL** | **FAIL** |
| can never say `REMOVED_AT_SOURCE` | **FAIL** | PASS | PASS |

So each half of the classifier is covered by a named arm and none is vacuous. A test nobody has watched
fail is a rumour.

## ⭐ The arms are now proven on a BROKEN SUBJECT, not only on a plant

`scripts/audit-rename-handling.mjs`-style planting proves a detector fires. It does not prove it
fires on a loss the **production code path** produces — no production code made a planted `DELETE`.
The distinction is dashboard-manager's:

> A planted control proves the instrument works. A **broken subject** proves the instrument works
> **on this subject**.

A real broken subject existed and needed no simulation: the pre-closure one-level expansion at
`871a1d65`. `scripts/audit-ref-conservation-broken-subject.mjs`, raw output in
`broken-subject-output.txt`, nothing planted in either run:

| subject | result |
|---|---|
| `871a1d65`, one-level expansion | **6 LOST**, 2/8 survived — names all six `outerA/B/C` IMPORTS and CALLS |
| current, fixed-point expansion | **0 LOST**, 8/8 survived |

Exactly the six in `reproduction-output.txt`. The quiet arm matters as much as the loud one: a
detector that shouted on both would have passed the broken arm for the wrong reason.

⚠ **ARM B and ARM C plant their losses.** The fixed-point closure means the real loss no longer occurs
on this fixture, so deleting an edge whose source still emits it is the only way to show the detector
fires. They prove the **detector** works. They are **not** evidence that a loss happened, and nothing
derived from them may be reported as one. Each plant refuses loudly rather than passing vacuously if the
edge it needs is not there to delete.

## ARM C is the arm that caught a real defect, and it caught it in my own instrument

ARM C **failed on its first run**, exactly as its pre-registration allowed for. The planted IMPORTS loss
was classified `REMOVED_AT_SOURCE` — a false quiet, in the relation the incremental edge loss primarily
destroys.

The cause, measured on a two-file fixture rather than reasoned about:

```
emitted   { relation: 'IMPORTS', target: 'src/middle.js' }     a repo-relative PATH
recorded  node { label: 'middle.js', file_path: 'src/middle.js', type: 'File' }
```

Matching an emitted target against `nodes.label` alone can therefore never match an import.

⛔ **AND THIS WAS ALREADY KNOWN.** `FINDING.md` diagnosed it correctly when the point-in-time figure was
published: "an import target is a module path, the resolved node's label is a symbol, so they cannot
match; the check does not describe IMPORTS and should not be read as if it did." The key was documented
as broken and shipped anyway, with a caveat instead of a fix.

⭐ **THE LESSON, and it is the useful part of this whole episode: a caveat travels less far than the code
it excuses.** In the point-in-time direction the flaw was a visible over-count that a caveat could
honestly bound. When the same key was reused in a new script the caveat did not come with it, and the
identical flaw became a **silent under-count** — a false quiet, which no reader can spot. A limit written
next to a number protects that number. It does not protect the next use of the mechanism that caused it.
The fix belonged in the code; the caveat only made it survivable in one direction.

## The population, and the correction that took the most thought

Not the raw recorded set. One edge is addressable by several strings — label, path, `path.label`, id —
so a single dropped edge would report four losses, three of which nothing ever emitted. The population is
**the refs the graph actually held at baseline, expressed in the one form the extractor emits them in**:
the emitted-and-recorded intersection.

⚠ **Stated limit:** a ref emitted at baseline but never recorded is **excluded** here. That is a
point-in-time loss and `audit-ref-conservation.mjs` owns it. This audit answers "did a ref the graph held
survive a run", and it would be dishonest to let it imply the other.

## The corrected point-in-time figure, and the freshness caveat on it

Same instrument, corrected key, at `8eb6b65b` on a freshly forced index. Raw:
`conservation-output-corrected.txt`.

| | conserved | reported losses |
|---|---|---|
| as published (`e3c25113`) | 90.19% | 4,514 — IMPORTS 4,488 / CALLS 17 / CONTAINS 9 |
| corrected key, class split (`8eb6b65b`) | **94.22%** | **35** — IMPORTS 25 / CALLS 10, plus 2,663 separated |

The two runs are **not the same population** — the repo gained files between them — so no clean
subtraction between the rows is offered, and none should be inferred.

⚠ **The per-binding class is separated, not cleared.** `import { a } from './m.js'` emits a ref for the
module and one per binding; the ingest path records the module edge and nothing for the bindings, with
no refusal row. Whether that is a defect or an intermediate is **unresolved**: the binding information
is demonstrably consumed elsewhere, since a `CALLS` ref carries an `importMap` built from it, which
argues intermediate. Nothing here decides it.

⚠ **This run's `FRESHNESS` control reported a DIRTY TREE**, naming three paths: `latest.log` and the two
output files being written. Measured rather than waved away — none of the three is in the extraction
population, and a positive control confirms the probe can answer IN POPULATION for a file that is
(`scripts/lib/ref-keys.mjs`). So the warning is real and the run is uncontaminated. The control fires on
any dirty path rather than only on ones in the population, which is the fail-closed direction.

## What this does not establish

- **No rate.** Three arms on one synthetic fixture. This is a proof that the detector works, not a
  measurement of how often anything is lost.
- **Nothing about history.** It says nothing about which historical run produced the nine live specimens,
  and it cannot: a graph missing an edge cannot report that it is missing.
- **Only two relations.** `CALLS` and `IMPORTS` have planted arms. Every other relation is unprobed.
- **The widened key can only move conservation up.** A key that matched everything would read 100%, so
  the corrected point-in-time figure is evidence that a previously reported loss was an artifact, never
  evidence that conservation is good. That is what ARM B and ARM C are for.
