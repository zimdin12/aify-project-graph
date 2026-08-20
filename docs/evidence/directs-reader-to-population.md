# DIRECTS_READER_TO — population measured across four corpora, before the rule exists

Purpose: supply the population and the negative control BEFORE the rule is designed, since the
negative control is the state these repos rarely occupy. Read-only; nothing indexed.

## The reported zero was instrument-incapable

The first probe reported "866 read-ish sentences, 0 naming a `.md`". Executed directly:

    regex  /\b(read|see|start with)\b([^.\n]{0,80})/i
    input  "Read `AGENTS.md` first. It contains the full project guide."
    capture -> "Read `AGENTS"

The character class excludes `.`, which is IN `.md`, so the capture stops one character before the
thing it searches for. **It could not return a filename.** Corrected, the same input captures the
whole sentence.

⇒ The population is not empty, and it is not empty in THIS repo either — see below.

## Population, tight definition (read-verb + `.md` target + order word, minus hostile witnesses)

    corpus                 tracked .md   read-verb lines   DIRECTIVES   excluded (fence/neg/quote)
    aify-project-graph          156             836            13            1 / 2 / 1
    echoes_of_the_fallen        122             429            26            0 / 1 / 2
    sand_castle                 923            1686            22            0 / 10 / 0
    lc-api                        8               7             0            0 / 0 / 0

Instrument controls, run against synthetic input so both outcomes are demonstrated:

    PRESENT  "Read `AGENTS.md` first."               -> true
    ABSENT   "Read the code first."      (no target) -> false
    ABSENT   "See docs/x.md for details."(no order)  -> false
    ABSENT   "Do not read AGENTS.md first." (negated)-> false

## ⚠ The negative control is DEFINITION-DEPENDENT, which is the part to decide first

Same probe with the order-word requirement dropped — i.e. "points the reader at a document" rather
than "tells the reader what to read first":

    aify-project-graph   13 -> 65
    echoes_of_the_fallen 26 -> 96
    sand_castle          22 -> 86
    lc-api                0 ->  1

The population roughly quintuples, and **lc-api stops being empty**. Its single loose match:

    app/Components/Api/Company/Search/Impl/README.md:7
      "Refer to `app/Components/Api/BusinessRegistry/Processor/Impl/README.md` for more info."

That is a real cross-reference and not a read-order directive. So lc-api is a true negative for
READ-ORDER and NOT a true negative for POINTER. A precision floor graded on "lc-api returns 0"
holds only under the tighter relation, and which relation `DIRECTS_READER_TO` names decides
whether the negative control is valid at all. Worth fixing before the rule, not after.

## Caveat on the exclusion counts

The negation filter here is crude — a `do not|never|rather than` test on the line. Under the loose
definition sand_castle shows 36 "negated", and spot-checking those finds lines like "are **never
read in engine/render**", which concern code rather than reading order and were never directives
in spirit. ⛔ Do not read these counts as a measured hazard rate for hostile witnesses. They show
the categories OCCUR; they do not size them.

## What this does not do

It does not implement or grade the rule, and it does not propose the extraction. It establishes
that the population exists, that it exists in this repo, that one available corpus is genuinely
empty under the tighter reading, and that the count is highly sensitive to a definition choice
that has not been made yet.

## Phrasing diversity — "Read X first" is 38%, not the whole population

    DISTINCT FORMS  44        across 68 instances
    "Read <T> first."         26 of 68 = 38%
    forms occurring ONCE      38

    x16  Read `AGENTS.md` first.                                  the monoculture, one repo
    x 2  Read CLAUDE.md first, then find your role below          TWO-STEP ORDERING
    x 1  (read `brief.agent.md` first; use `graph_onboard` …)     parenthetical, mid-sentence
    x 3  | ↳ implementation plan: [docs/plan/…](…)                table row, NO VERB
    x 1  **`brief.onboard.md`** — … read-first, tests             "read-first" as a noun

A matcher tuned to the dominant form scores 38% and misses 38 singletons. The two-step case is
structural rather than lexical: "Read CLAUDE.md first, THEN find your role" is a sequence, and a
relation carrying one target per sentence cannot represent it.

## ⛔ This repo's population is contaminated by the apparatus, and the apparatus is mine

Three directive-looking lines in this repo live in files written today while measuring this:

    docs/evidence/read-first-docs-second-corpus-echoes.md
    docs/evidence/directs-reader-to-population.md
      PRESENT  "Read `AGENTS.md` first."               -> true
      input  "Read `AGENTS.md` first. It contains the full project guide."
      … line 3, verbatim: **"Read `AGENTS.md` first."**

Those are control strings and quotations of ANOTHER repo's directive. They are the quotation
hostile-witness — predicted before anyone had seen an instance, then created here by the act of
measuring. Ten evidence commits landed today.

⇒ **`docs/evidence/` is apparatus and must be excluded from the grading population**, pre-registered
here before the extractor exists. Left in, a rule would score test fixtures as authored directives
and the failure would present as a working rule.

## The full form enumeration, with the apparatus exclusion applied

Excluding `docs/evidence/` moves the population 44 forms / 68 instances -> **40 forms / 64
instances**, which sizes my contamination at 4 instances. Everything below is the clean set.

    40 distinct forms · 64 instances · 6 multi-target

### ⛔ Structural cases beyond the two-step already discussed

    "**Read `AGENTS.md` first.** Then your role file. Then `docs/now.md` (live state). Then …"
      THREE-STEP CHAIN. Worse than two-step for one-target-per-sentence, and the later steps
      name documents the first sentence does not.

    "**Before picking any lane, read `docs/now.md` (live state), then `docs/contracts/…` + …"
      CONDITIONAL ordering. The precedence is scoped to an activity, not global. A relation with
      no condition slot would assert this as an unconditional entry point.

    "- `AGENTS.md` — root agent guide (read first)."
      REVERSE ORDER. Target first, directive as a parenthetical suffix. Any left-to-right
      verb-then-target matcher misses it.

    "This project uses a shared `AGENTS.md` as the entry point for all teammates."
      NO READ VERB AT ALL. "entry point" carries the whole meaning.

    "| ↳ implementation plan: [docs/plan/…](…)"      table row, no verb, x3
    "…hubs, read-first, tests."                      "read-first" as a NOUN — false-positive class

### ⚠ The tail is not all directives, and that caps precision

Of the 40 forms, a substantial share are NOT authored directives at all. Present in the tail:

    · session/status log lines that merely contain a `.md` and an order word, e.g. a commit
      summary listing shas, and a night-run results banner
    · PROSE ABOUT directives — "the session-start skill tells every agent to read
      brief.agent.md first" — describing one, not issuing one (your own observation, confirmed
      here in the clean set)
    · spec pointers carrying an order word — "**Spec:** `…design.md` — read this before starting"
      which IS arguably a directive, but targets a spec rather than an entry point

⛔ I am NOT converting that into a precision estimate. Deciding which of 40 forms is a genuine
authored ordering instruction is exactly the adjudication the grade exists to perform, and a
number I produced by eyeballing it would be an ungraded opinion wearing a decimal point. What
this establishes is that the false-positive CLASSES are present in the population, not their rate.

⇒ If it helps, the clean 40-form list is reproducible from this file's method and I will grade
the full population properly against the extractor when it arrives.
