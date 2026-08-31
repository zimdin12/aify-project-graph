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

## ⛔ RETRACTED: the 52.9% figure was not a measured false rate

I originally published **"P(an edit is unrelated to a given anchored symbol) = 52.9%"** and called
the carrier "53%-wrong". Review rejected the number and is right: it is a **model-derived proxy
under an edit model I never stated**, not an observed false-positive rate. It silently assumes:

- edits distribute uniformly across the symbols in a file
- one edit affects one symbol
- "related" means span overlap — not behaviour, contract, or dependency effect
- the edited files are the anchored ones

None of that was measured. Sound arithmetic, wrong noun — the same defect this repository keeps
producing, and I produced it inside the document rejecting a carrier for imprecision.

**The counts stand. The probability does not.**

## What actually disqualifies the carrier — by construction, not by rate

`structural_fingerprints` is keyed on `file_path`. **One changed file marks every symbol anchor in
that file indistinguishably.** With a median of 3 and a mean of 4.3 symbols per file, a per-file
fingerprint cannot carry a per-symbol truth at all — not because the error rate is high, but
because the carrier has no per-symbol resolution to lose. That is decisive without any probability
attached.

## Options, with the trade-off

## ⛔ AND MY RECOMMENDED OPTION HAD NO BASELINE

I recommended anchor-scoped hashing at read time as the "reversible default, no migration".
Review's objection is decisive: **a hash comparison needs two authorities.**

```
baseline: exact bytes/hash accepted when this anchor was LAST CONFIRMED
current:  exact bytes/hash for the same resolved identity NOW
```

The per-file index fingerprint is not that baseline. **Reindexing after an edit refreshes it and
erases the very drift M3b exists to retain.** Reading a span now, with nothing persisted to compare
against, is not a comparison at all. "No migration" was quietly becoming "no baseline".

Two further limits: a body-span hash proves only that *anchored bytes changed* — it misses
behaviour changes in called helpers, constants, macros, generated code and build flags outside the
span. And line spans drift across edits, so "the same symbol" is exactly M1's identity problem.

## DISPOSITION: HOLD, option (3)

The gap stays **open and stated**, and no signal ships. M3b is held behind M1 identity plus a
persisted per-anchor confirmation lineage (identity, commit/tree, normalised body hash,
algorithm/version, confirmation time and actor). Emit
`anchor_bytes_changed_since_confirmation` / `reconfirm_candidate` — never `claim_out_of_date`.

## The threshold, corrected

I proposed a single ~10% ceiling. Review splits it, and the split is right:

- **Carrier correctness: zero tolerance.** A prompt must never name an unchanged population as
  changed. Identity ambiguity, missing baseline, moved span or unreadable bytes become typed
  **UNKNOWN**, never a reconfirm.
- **Policy usefulness: no universal ceiling.** Measure on an adjudicated population —
  `unit = (confirmed anchor identity, subsequent commit)`, truth = a reviewer saying the anchored
  contract needs reconfirmation — and report TP/FP/FN/TN plus alerts per session and handling cost.
  `FP/(TP+FP) <= 10%` is a *hypothesis* for a non-blocking candidate, not a grounded ceiling. For a
  blocking prompt, any observed avoidable FP stops rollout until the class is fixed.
