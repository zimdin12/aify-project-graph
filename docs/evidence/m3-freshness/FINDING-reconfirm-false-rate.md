# The ~77% false-reconfirm model was right, and slightly conservative: measured 81.5%

**Date:** 2026-09-03
**Preregistered:** `PREREGISTRATION-reconfirm-false-rate.md`, committed at `7f061c7` before the run.
**Verdict against the preregistered rule (≥70% ⇒ the model holds):** the model holds.

---

## Result

Over the last **600 non-merge commits** of this repository:

```
files measured .................... 1185     (16 skipped, all deleted-at-commit, reported)
claims woken (file granularity) ...  9465
claims whose symbol ACTUALLY moved   1749
FALSE-RECONFIRM RATE ..............  81.5%   model said ~77%
```

All five controls passed: determinism (same blob twice), the synthetic no-op edit (a blob compared
against itself produced drift in 0 of 1185 files), the positive control (1,749 symbols really did
change, so the extractor and diff are alive), skip accounting (16, all reported), and range.

⇒ A reconfirm firing at FILE granularity would wake roughly **five claims for every one that
actually moved**. The order-of-magnitude argument in `FINDING-m3b-does-not-earn-its-place.md` was
correct and, if anything, understated.

---

## ⛔ The first run measured my own session and read 91.5%

The first population was the last **60** commits and returned **91.5%**. That number is real for what
it measured and wrong as a description of this repository:

- All 60 commits fell in a two-day window — the session that produced them.
- Only **21 of 60 touched code at all**; the rest were docs and evidence.
- That session's code commits are unusually comment-heavy, and a comment block wakes every symbol in
  a file while changing no fingerprint.

Same instrument, same code, **+10 points** purely from which 60 commits were chosen. The correction
was to widen to 600 commits, which reaches genuine development history rather than two days of one
agent's documentation work.

★ The instrument was never wrong. The *population* was, and every control still passed while it was
wrong — determinism, the no-op edit and the positive control cannot see a badly chosen population.
Controls prove the measurement is sound; only asking what the number is a number OF catches this.

---

## What this does and does not settle

**Settles:** a FILE-granular reconfirm is confirmed a bad signal on this repo's real history, by
measurement rather than by model.

**Does not settle, and must not be read as settling:**

- **It is not an argument against a SYMBOL-granular reconfirm**, whose false rate is 0 BY
  CONSTRUCTION — that is the definition, not a finding. And file granularity is not forced:
  `FINDING-fingerprint-coverage-by-node-type.md` shows per-symbol fingerprints are stored and an
  incremental index already re-parses changed files.
- **It says nothing about whether claims go stale often enough to matter.** That is the question
  that should actually decide M3b, and nothing here touches it. A good number here is not a reason
  to build.
- **It is one JS/TS repository's own history.** Not a rate for other repos, and not obtainable for
  C++ with this instrument at all: `Symbol` nodes — the entire code-intel/clangd population — carry
  no fingerprint, so they cannot be compared.

---

## Where this leaves M3b

The disposition's two legs, after measurement:

| leg | status |
|---|---|
| STRUCTURAL — file-granular reconfirm fires too often | **CONFIRMED by measurement** at 81.5%, worse than the 77% modelled |
| STRUCTURAL — but file granularity is FORCED | **REFUTED**; per-symbol fingerprints exist, symbol-granular comparison costs no extra parse |
| BEHAVIOURAL — bodies excluded, so behavioural drift is invisible at any granularity | **UNTOUCHED**, and it never depended on granularity |

⇒ The recommendation to scope M3b to structural claims or drop it **still stands, on the behavioural
leg**. What changed is the reason a file-granular build is rejected: it is now measured rather than
modelled, and the granularity escape hatch is real but does not rescue the behavioural half.
