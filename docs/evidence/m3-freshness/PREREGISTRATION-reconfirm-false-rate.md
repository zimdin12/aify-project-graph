# Preregistration — the false-reconfirm rate, measured instead of modelled

**Written 2026-09-03, BEFORE the first run.** Committed before the result exists so the decision
rule cannot be fitted to the number.

## Why

`FINDING-m3b-does-not-earn-its-place.md` disposes of M3b partly on a **~77% false-reconfirm rate**,
and labels it honestly: a MODEL from mean symbols-per-file under an assumption of uniform edit
distribution, not an observation. This repo has already retracted one model-derived proxy that was
presented as an observed rate (`GRANULARITY-FINDING.md`'s 52.9%), which is exactly why this one is
worth converting rather than quoting again.

## Question

Over real edits, if a reconfirm fires at FILE granularity, what fraction of the claims it wakes were
about symbols that did not actually change?

## Population

The last **60 non-merge commits** of this repository, restricted to files that have a language
config (`hasLanguageConfig`, derived from the real `LANGUAGE_CONFIGS` registry).

## Identity rule

A **claim is anchored to a SYMBOL**, identified by its qualified name (`qname`) within a file. A
rename therefore counts as a remove plus an add, not as a change — stated because it is a judgement
that moves the number, not a detail.

## Measure

- **Woken (file granularity):** every symbol in a changed file — the UNION of the symbols present
  before and after. The union, not the after-set: `compare` counts a REMOVED symbol as changed, and
  a removed symbol is absent from the after-set, so an after-set denominator can produce a rate
  below zero. A rate that can leave [0,1] is a rate nobody should quote.
- **Truly changed:** symbols whose `structural_fp` differs, plus symbols added or removed.
- **False-reconfirm rate:** `1 - changed / woken`.
- **Symbol granularity is 0% BY CONSTRUCTION.** That is the definition, not a result, and it is
  reported only to make the file-granularity number readable. It must never be quoted as a finding.

## Decision rule, fixed in advance

| measured | conclusion |
|---|---|
| ≥ 70% | the model holds; the structural leg of the disposition stands as written |
| ≤ 30% | the model overstates by more than 2×; that leg needs redoing |
| 30–70% | report the number, claim nothing more |

## Controls, in the same pass

- **Determinism** — extracting the same blob twice must give identical fingerprints. If not, every
  "changed" is noise and the run is void.
- **Negative (synthetic no-op edit)** — a blob compared against ITSELF must yield zero changed
  symbols. Non-zero means the comparison manufactures drift.
- **Positive** — across 60 commits, changed symbols must be > 0. A clean zero would look like a
  spectacular result and would actually mean the extractor or the diff is broken.
- **Denominator honesty** — files that fail to parse or resolve are COUNTED AND REPORTED, never
  silently dropped. A quietly shrinking denominator is how a rate lies.
- **Range** — the rate must fall inside [0, 100]. Outside means the denominator is the wrong set.

## Claim ceiling

One repository's history, a JS/TS codebase, its own commits. This is **not** a rate for other repos
and **not** a rate for C++ — where `Symbol` nodes carry no fingerprint at all
(`FINDING-fingerprint-coverage-by-node-type.md`), so the measurement cannot even be taken on that
population with this instrument.

⚠ It says **nothing** about whether claims go stale often enough to matter, which is the question
that should actually decide M3b. Converting the model does not answer that, and a good number here
must not be read as a reason to build.
