# M3b: the signal has no claims to wake, and the ones it could wake are already covered

**Date:** 2026-09-03
**Status:** this closes the scope-or-drop question left open by
`FINDING-m3b-does-not-earn-its-place.md`. The recommendation there was "scope to structural claims
or drop it". **Drop, and now on measurement rather than judgement.**

---

## The three checks, all read-only, all against the live graph

### 1. The symbol population is 41, not 877

Edges leaving a `Document` node — the doc→code reference set, which is the closest thing this system
has to stored claims:

| target type | edges | is it a code symbol? |
|---|---:|---|
| File | 442 | no — a whole-file pointer |
| Document | 236 | no — doc→doc link |
| Config | 89 | no |
| Directory | 68 | no |
| **Function** | **35** | yes |
| **Class** | **4** | yes |
| Module / Entrypoint | 2 | yes |
| Symbol | 1 | yes, but carries no fingerprint |
| **TOTAL** | **877** | **41 are symbol-targeted (4.7%)** |

### 2. Broken pointers are ALREADY detected, and the detector is live

`mcp/stdio/analysis/doc-links.js` classifies a reference that no longer resolves as
`no_such_path`, and the report is written to `.aify-graph/doc-link-misses.json` — 469KB on this repo,
regenerated today. The population that a reconfirm would serve is already covered where a reference
genuinely breaks.

### 3. There is no claim store at all

The schema holds exactly four tables: `nodes`, `edges`, `code_intel_records`,
`code_intel_collections`. No claims, no anchors, no confirmation lineage. `reconfirm` appears
nowhere in `mcp/`.

---

## The distinction that actually decides it

A doc reference saying *"see `graphCallers`"* is a **POINTER**. It is valid exactly as long as the
symbol exists, and it breaks only when the target moves or is deleted — which check 2 already
detects. Structural drift on a pointer is noise: the pointer did not become wrong because the
function gained a parameter.

A reconfirm signal is for **CLAIMS** — "X validates its input", "X returns null on failure". Those
are the statements that go quietly out of date while still resolving. Two things are true of them
here:

1. **Nothing stores them.** They would need a claim store built first (check 3).
2. **The fingerprint cannot see them.** `structuralFingerprint` excludes bodies by design, so
   flipping a comparison or changing a constant moves nothing —
   `FINDING-m3b-does-not-earn-its-place.md`'s behavioural leg, which no granularity fixes.

⇒ M3b would require building a substrate that does not exist, in order to serve claims the existing
substrate is structurally blind to, for a symbol-targeted population of **41** on this repo.

Against this plan's purpose test — *does this make an agent's decision better, faster or safer than
grep alone?* — that does not clear the bar, and the plan's stop condition says to name that rather
than keep building.

---

## ⛔ The aggregate said 99.9% and it was the wrong noun

My first query asked what share of doc-edge targets carry a non-empty `structural_fp` and got
**99.9%** — a number that reads as "almost every doc claim is reconfirmable". It counts Files,
Documents, Configs and Directories, all of which carry fingerprints for reasons that have nothing to
do with symbol drift. The disaggregated answer is **4.7%**.

Same query, same data, opposite conclusion.

★ This is the SAME wrong-noun error as `FINDING-fingerprint-coverage-by-node-type.md`, made one
cycle after writing that finding down. Recording a lesson did not prevent repeating it; printing the
BREAKDOWN instead of the TOTAL did. The mechanical habit caught what the remembered rule did not.

---

## Claim ceiling

One repository, whose documentation references files far more often than symbols. A codebase with
denser symbol-level documentation would have a different population and could support a different
conclusion. That has not been measured, and nothing here should be read as a general claim about
documentation-heavy projects.

Nothing here measures how often a real claim goes stale, either. It measures that there is no place
to put one and nothing to detect it with.
