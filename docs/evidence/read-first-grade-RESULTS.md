# read-first entry-point grade — RESULTS

Pre-registration: `read-first-grade-PREREGISTRATION.md`, committed at 6beb00c BEFORE any output
here existed. Code graded: a8f1337. All four graphs read from `db.backup()` snapshots.

## Scoreboard

Ground-truth corpora: **2**. Denominator reported with every rate, as pre-registered.

    ordering                    echoes   sand_castle   passed
    inbound-primary (SHIPPED)    FAIL       FAIL        0 of 2
    recency-primary              PASS       FAIL        1 of 2
    outbound-primary             FAIL       FAIL        0 of 2

**⛔ The pre-registered withdrawal threshold is CROSSED.** The stated entry point falls outside
the top 2 under the shipped ordering on 2 of 2 ground-truth corpora, which is a majority.

The larger threshold is NOT met. All three orderings miss on sand_castle only — 1 of 2, exactly
half, not a majority. So this does not support "no signal in this graph identifies an entry
point". Recency does identify it on one corpus.

## Detail

    echoes_of_the_fallen    99 of 103 Documents eligible · truth AGENTS.md (eligible)
      SHIPPED    contracts/worldbuffer-authority [2026-04-27] | contracts/configuration-authority
                 AGENTS.md rank 9 of 99
      recency    AGENTS.md [2026-06-12] | docs/now.md                          PASS, rank 1
      outbound   specs/shell-native-sim-shader-inventory | operations/commands-index   rank 7

    sand_castle            798 of 978 Documents eligible · truth AGENTS.md (eligible)
      SHIPPED    ARCHITECTURE.md [2026-05-31] | docs/operations/testing.md [2026-06-11]
                 AGENTS.md rank 10 of 798
      recency    docs/plan/sand-castle-design.md | docs/now.md   [both 2026-08-20]
      outbound   docs/now.md | operations/sc-claude-codebase-audit-2026-05-22

⇒ The shipped ordering is not random — rank 9 of 99 and rank 10 of 798 put the right answer in
the top 1.3% on the larger corpus. It is systematically NEAR and reliably outside the two slots
the section actually ships. Tuning that gap is a different proposition from a signal that is
uncorrelated, and this grade does not say which is available.

## ★ Contamination found, checked, did not change the verdict

echoes `AGENTS.md` showed last-commit 2026-08-19 — which is `fee8837`, a commit from THIS
session's own docs-recovery branch. Our editing had made the ground-truth document the newest
in the corpus, favouring exactly one of the three orderings under test.

Re-measured with recency taken from `main`, which does not contain those commits:

    AGENTS.md    HEAD 2026-08-19  ->  main 2026-06-12
    recency-primary still PASS, AGENTS.md still rank 1 of 99

The pass survives decontamination. Reported because it had to be checked, not because it moved.

## Corpora that could not be scored

**aify-project-graph — GROUND TRUTH NOT IN CORPUS.** The rule's first match under the
pre-registered file priority is `AGENTS.md:204`, pointing at `.aify-graph/brief.agent.md`: a
generated artifact, not a document in the graph. A target the ranking cannot return would score
an automatic fail that means nothing, so it is excluded from both numerator and denominator.
Unscored, its shipped top-2 is `README.md | docs/code-intel-v2-status.md`.

**lc-api — NO GROUND TRUTH, and a separate producer defect.** No sentence matched the rule. But
the graph also holds **0 Document nodes** against 15,628 nodes and 50,527 edges:

    node types present: Class, Directory, External, File, Function, Method, Module, Test

The repo has `AGENTS.md`, `CLAUDE.md` and `README.md` at its root. Documents exist on disk and
none reached the graph, so on this repo the doc section renders empty and nothing distinguishes
"no documents" from "documents were never ingested". That is upstream of the ranking and does
not bear on the grade.

## What this grade does not establish

n = 2 is the whole population with usable ground truth. The threshold is crossed, and it is
crossed on two corpora, both from the same author, both following an `AGENTS.md` convention —
their `CLAUDE.md` line 3 differs verbatim, so the text is not copied, but the convention is
shared. A majority of two is the pre-registered rule honestly applied and it is also a thin
basis for deleting a feature. Both of those are true at once and the decision is not mine.

Not measured, as pre-registered: whether any ranked document is a good document to read.
