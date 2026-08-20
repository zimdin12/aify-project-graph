# Open decisions — 2026-08-20

Everything on the roadmap that is *engineering* is done. What is left is four questions that are
Steven's, not mine, each with what I would do and why. Nothing here is blocked on more work; each
is blocked on a preference.

---

## 1. ⚖ Boundary nodes — may the graph hold what it excludes?

**The question.** A language server resolves a first-party reference to a declaration that lives
outside the corpus, and the record names where the declaration actually is. Measured at `80fd7bf`:
**15 collected files outside the corpus, every one a `.d.ts`** — `lib.es5`, `lib.dom`,
`ajv/dist/core`, `vitest/dist/node` — plus **52 nodes still under `reference/`**.

You cannot describe a reference to `Array.prototype.map` without naming the file that declares it.
So the nodes are honest. They are also inside trees `.gitignore` excludes.

**Why it is a decision and not a bug.** `reference/` has now produced nodes by **three different
routes**: the sweep created directory nodes there, the collector enumerated files there, and the
resolver targets declarations there. Each fix was correct *for its own producer*. The exclusion is
a property of the **corpus**, and every producer decides independently whether to honour it — so
the current answer is "yes, by accident, for three different reasons."

**What I already did, which is safe either way.** The coverage denominator no longer counts them:
594 → 556, and 556 matches the file enumerator's independent count exactly (`16889a4`).

**My recommendation: keep them, but type them as boundary.** The importer already has an `External`
node type. A resolution target outside the corpus should be `External`, not `Symbol`, so that "is
this in the corpus" is a **physical property of the node** rather than a path pattern every consumer
re-derives. That is the same move that fixed the packet governed set and the document allowlist.

⚠ I did not do it tonight because it changes node typing, and `whereis` / `search` / `census` all
read node type. It wants its own slice with its own evidence, not a tail-end change after eight
data-loss fixes.

---

## 2. ⚖ Phase 4 — the refactor's fate

Unchanged from the roadmap and still yours. dev says drop it: *"`packet.js` being 1453 lines is not
itself a user defect. The previous '~710' target was an invented global authority."*

**My read is unchanged too:** dev is right that "no file over N" is an invented authority — it is
exactly how `067e3ad` came to be titled "TARGET MET" while fourteen files exceeded it. If you want
it kept, keep it as a **blocked-work** target: split only where a named guarantee or test is hard to
hold, `packet.js` first, and the completion claim names its population or is not made.

---

## 3. ⚖ Phase 3b — hook-injected pointers, placement

Content is ours and ready; **placement** (Claude Code hook vs `aify-wrapper` contract) is yours. It
still needs a measured fire rate before it ships to anyone, or it becomes noise that gets turned
off — the same failure as a warning that fires on every repo.

---

## 4. ⚠ Collections now accumulate, by design

Both new prune guards are correct and together they mean **no run in a multi-batch repo may prune**:
batch 1 leaves a remainder so it declares a file scope, and every later batch is a continuation.
There are 8 collections on this repo and 3 hold zero records.

`compactCodeIntelRecords` is now the only thing reclaiming space. That is the safe direction — it
errs toward keeping evidence — but the prune's stated justification ("keeps the table from growing
unbounded") is **conditional now**, and you should know that rather than discover it at 700MB.
sand_castle reached 1.03M rows and 732MB across 13 runs before any of this existed.

**My recommendation:** leave it. Reclaiming space is a cheap scheduled job; restoring destroyed
evidence is a 15-minute re-collect and, for a while tonight, was not possible at all.

---

## What is NOT waiting on you

Eight data-loss defects found and fixed today, each with a regression test watched failing against
the old code. The trust spine was destroyed and restored: **167,045 records over 554 of 556
first-party files, 0 edges pointing into `reference/`** — read at `80fd7bf`, and only true there,
because LSP edges carry a real `source_file` and the post-commit reindex erodes them one bite per
commit.

The full account is in `memory/authority-is-not-what-was-reported.md`.
