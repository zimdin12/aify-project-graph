# Preregistered: are the recovered edges real, or name collisions?

**Written 2026-09-06 before a single edge is graded.** This is the follow-up that settles a direction
I already got wrong once, so the rules go down first.

## Background, and what is already known

A forced rebuild produces 6,625 symbol-to-symbol edges where the inherited graph held 5,370 — 1,411
edges present only in the forced build. I first called that a fail-open under-report, and
**withdrew it**: 712 of the 1,411 (50.5%) target a name of three characters or fewer (`has` 198,
`dir` 130, `a` 100), which is the name-collision overcount signature this repository has documented
before.

⇒ Both effects — genuine recovery and collision noise — are present, and counting cannot separate
them. **Only reading the source can.**

## Population and sampling, fixed now

**Population.** The 1,411 edges in the forced digest (`fca4ab53`) and absent from the inherited one
(`4bd6dc86`), restricted to those whose TARGET leaf name is **at least 8 characters**.

⚠ **This is deliberately the FRIENDLIEST subpopulation to the recovery hypothesis.** Short names are
where collisions live, so grading them would stack the deck the other way. If distinctive names do
not grade as real, nothing else will.

**Sample.** Sort the qualifying edge keys lexicographically, then take a **systematic sample**: every
`floor(N/30)`-th entry, up to 30. Deterministic and reproducible, and it removes any chance of
picking the ones I like.

## Grading rule, fixed before seeing any edge

For each sampled edge `FROM > TO`, open the source file of `FROM` and decide:

- **REAL** — that file genuinely references the `TO` symbol *as defined in `TO`'s file*: an import of
  it, or a call whose receiver is that module/object.
- **COLLISION** — the name appears, but it resolves to something else: a different module's function
  of the same name, a local variable, a method on a builtin or third-party object, or a property
  access unrelated to the definition.
- **UNDECIDABLE** — cannot be settled by reading the two files.

## Decision rule

| REAL share of decided | Verdict |
|---|---|
| **≥ 70%** | A genuine recovery effect exists among distinctive names. Its size is smaller than 1,411 and must be reported as *"of the N distinctive-name edges"*, never as the whole gap. |
| **≤ 30%** | Even the friendliest subpopulation is mostly collisions ⇒ the gap is noise and a forced rebuild is a DOWNGRADE in precision. |
| **31–69%** | Mixed. Report the proportion and refuse a verdict. ⛔ A binary check reports the wrong conclusion when reality is neither of its options. |

**Abandon rule.** If **more than a third** of the sample grades UNDECIDABLE, the measurement is void:
report that the method failed and do not grade the remainder. A sample I can only half-read is not a
result.

## What this cannot answer

⛔ It says nothing about the ~700 short-name edges, which remain presumed collisions and unmeasured.
⛔ One repository, one language pair (`.js`/`.mjs`). Not a rate for anyone else's code.
⛔ It does not establish that any shipped verb's answer changes. That is still untested.
