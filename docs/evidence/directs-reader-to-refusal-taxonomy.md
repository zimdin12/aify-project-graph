# DIRECTS_READER_TO — the refusal taxonomy

**Status: the RULE is on hold. This document is not.**

The matcher is the cheap half and may be discarded: `graph-senior-dev` has held the relation pending
a representation ruling, and `ef-manager`'s measurement argues against a phrase matcher at all
(40 forms / 64 instances, "Read X first" only 38%, 38 forms occurring exactly once).

⇒ **The refusal classes below are a design result, not an implementation detail.** They cost a
corpus measurement across four repos, a definition ruling, two cases found by running against forms
nobody had listed, and one case that reframed a test already passing. Every one of them is still
true of the NEXT design — including a graph-shaped relation that can represent sequences — and most
remain true even if the relation is abandoned entirely. "read X before `<activity>` is task-scoped
advice, not an entry point" is a fact about documents, not about an extractor.

---

## The definition this taxonomy assumes

**`DIRECTS_READER_TO` = an authored ORDERING or PRIORITY instruction.** "Read X first", "start with
X". A cross-reference — "see X", "refer to X" — is **not** this relation; those are already
`doc_link` edges, and re-deriving them under a name claiming route authority would manufacture
authority out of the link layer.

⚠ **The definition decides the negative control.** `lc-api` yields ZERO under read-order and ONE
under "points the reader at a document" (`"Refer to .../README.md for more info."`). The abandon
rule — *any directive emitted in the negative-control corpus kills the rule* — only holds under the
read-order reading. Settled before the grade, in writing, not after.

---

## The refusals

Each is a refusal rather than a miss: the extractor SEES the line, classifies it, and declines. A
refusal that is counted is a disclosed recall cost; a silent one is a wrong recall number.

### 1. `conditional_scope` — ⛔ the most important one

> `**Before picking any lane, read `docs/now.md`, then `docs/contracts/pixel-motion.md` …**`
> `Read `docs/setup.md` before running the migration.`

Precedence scoped to an **activity**, not to the repository. The relation has no condition slot, so
emitting it asserts an unconditional entry point.

⇒ **Its failure mode is a WRONG entry point, not an absent one** — and a brief naming the wrong
first document is worse than one naming none. That is why it outranks the multi-step case despite
being quieter in the corpus.

★ It reframed a line I had already accepted as a passing test. `read X before <activity>` is the
same wrong answer as the leading-condition form, reached by different grammar.

### 2. `multi_step_ordering`

> `**Read `AGENTS.md` first.** Then your role file. Then `docs/now.md` (live state).`

A real directive the relation **cannot represent**. One target per sentence would record step one
and silently drop the ordering — a wrong answer; refusing is a recall cost that can be disclosed.

⚠ Key the refusal on **more than one target**, never on "two": the corpus contains a THREE-step
chain whose later steps name documents the first sentence does not.

### 3. `generated_artifact_target`

> `(read `brief.agent.md` first; use graph_onboard as fallback)`

Real advice about a **generated** artifact. It is rebuilt on every index, is not a repository
document, and can never resolve to a node — so an edge would have a target that cannot exist.

⚠ Match by **name as well as path**: the corpus writes `brief.agent.md` with no `.aify-graph/`
prefix, and a prefix test alone accepted it.

### 4. `reported_speech` — the largest false-positive class measured

> `the session-start skill tells every agent to read `brief.agent.md` first`

The document is not instructing its reader; it is **documenting a behaviour**. Both contain
"read … first" and only one is an instruction.

### 5. `quotation`

> `> Read `AGENTS.md` first.`

★ **Instanced in this repo, created while measuring the thing.** `docs/evidence/read-first-*.md`
quote another repo's directive while reporting on it. `graph-senior-dev` predicted this class before
anyone had seen an instance; `ef-manager` found three, all in apparatus they had written that day.

### 6. `noun_usage`

> `**`brief.onboard.md`** — entry points, subsystems, hubs, read-first, tests.`

`read-first` as a **noun** naming a feature. Appears in list contexts where a document is named
nearby, so it is a live false positive rather than a theoretical one.

### 7. `negated`

> `Do not read `OLD.md` first.`

An instruction NOT to do the thing reads as the thing under a naive matcher.

### 8. `ambiguous_multiple_targets`

Several targets, no sequencing word. The author named things and no order; picking one invents an
ordering nobody wrote.

⚠ Kept **separate** from `multi_step_ordering` deliberately. Ambiguity is a property of the data; a
multi-step chain is a limit of the **schema**. Merging them hides a schema limit inside a data
complaint.

---

## Known recall gap, disclosed rather than patched

> `This project uses a shared `AGENTS.md` as the entry point for all teammates.`

**No read verb at all** — "entry point" carries the whole meaning. Not matched, and deliberately
not attempted: the phrase is too loose to bound, and a rule reaching for it starts finding entry
points in prose *about* entry points, which is the reported-speech class one level less detectable.

## Apparatus exclusion, pre-registered

`docs/evidence/` is apparatus and is excluded from any grading population. With it: 44 forms / 68
instances. Without: **40 forms / 64 instances**. The difference is control strings and quotations
written by the grader while measuring.

⇒ The rule is that the grader excludes apparatus — a filter, not a relocation. Evidence belongs in
the repo under test.

## The grade, pre-registered before any output exists

- **Precision floor ≥0.95** across the apparatus-excluded population.
- **The negative control decides it.** A corpus with no authored directive must yield ZERO.
- **Recall reported as a FLOOR**, never a rate.
- **Refusal classes counted and reported**, so the recall cost is disclosed rather than invisible.
- ⛔ **Abandon rule:** below the floor, or any directive emitted in the negative-control corpus, and
  the rule does not ship. Not tuned, not disclosed — not shipped.
