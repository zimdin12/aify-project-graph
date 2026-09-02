# Preregistration — optimising the test stack (3738 tests, 452 files, 667 s)

**Written:** 2026-09-02, at Steven's request, before the timing run.

## The ask, and one honest caveat up front

> "we have 3738 tests !!! optimize, remove duplicates, etc. this stack must suck (having pointless
> tests)."

The principle matches this repo's own bar: *"Cover everything that matters, once. A second test of
the same property is cost without coverage."*

⚠ **But reconnaissance already weakens the "duplicates" premise, and that goes on the record before I
act on it:** 452 files, ~3579 parsed `it()` blocks, largest file 50 tests. Only **14** duplicate
titles, and most are artifacts of my own parser (template-literal titles such as
`"skipped — ${skipReason}"` truncate to the same string). 34 blocks matched "no assertion", but
several use `expectAbsentWithLiveMatcher`, which *is* one — so that detector has known false
positives.

I will not manufacture a cull to match the expectation. If the measurement says the stack is roughly
right, that is the finding.

## Question

Where does the 667 s actually go, and which tests are genuinely redundant or inert?

## Population

Every file under `tests/`. Timing from a single instrumented run (`--reporter=json`), so per-test
durations come from the runner rather than a guess.

## Identity rules — three separate claims, never merged

1. **SLOW** — a file in the top decile of total test duration. Purely a cost fact; says nothing about
   value.
2. **REDUNDANT** — two tests asserting the same property on the same subject, such that deleting one
   leaves the property still covered. Must be demonstrated per pair, not inferred from similar names.
3. **INERT** — a test that passes under a mutation to the code it names. Only a mutant establishes
   this. A test that merely *looks* trivial is not inert.

## ⛔ The deletion rule, fixed before any result

**No test is deleted unless I can (a) name the bug it would have caught, and (b) show another test
that still catches it — by mutating and watching that other test go red.** This repo is full of tests
whose comments record the incident that produced them; deleting one of those trades a silent
regression for a shorter run. `suite-composition.test.js:10` already reached the same conclusion for
its own class: *"The fix is classification, not deletion."*

Where a test is slow but valuable, the move is to make it cheaper, not to remove it.

## Finding schema

`{ file, tests, durationMs, class: 'slow' | 'redundant' | 'inert' | 'keep', evidence }`.

## Controls

- **POSITIVE — the timing data is non-empty and sums to roughly the reported wall clock.** A JSON
  report that parsed to zero would make every "slow" claim vacuous.
- **POSITIVE — a known-slow area appears.** The clangd integration tests are known to dominate; if
  they do not surface, the instrument is wrong.
- **NEGATIVE — a fast unit file is NOT classified slow**, or the threshold is meaningless.

## Claim ceiling

Timing is from **one run on this machine**, which has had clangd contention during this session.
Durations are indicative, not a benchmark; a single slow run does not prove a test is expensive. No
claim is made that the suite's *coverage* is adequate — this measures cost and redundancy only.

## Decided in advance

- **Runtime is concentrated in a few files** → optimise those (cheaper fixtures, shared setup),
  delete nothing.
- **Genuine redundancy found** → remove it, each removal carrying its (a) and (b) evidence.
- **Neither** → report that the stack is roughly right and that the premise did not survive
  measurement. That outcome is available and will be reported if it is what the data says.
