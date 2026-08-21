# Field test 2026-08-21 — brief document section reaches 2 of 4 surfaces

Run from the user's seat. Most of the round was blocked by a stale server and says so.

## Server was stale, verified independently of its own warning

    server.buildId    36e33f3   committed 2026-08-20 04:56
    server.startedAt  2026-08-20T01:56:42.176Z
    workingTreeCommit cb1eadb   staleProcess: true · 235 files / 157 executable in the delta

The staleness warning is emitted BY the stale process, so it was checked with git rather than
believed. Twelve commits under test — 900b7bb a8f1337 310fc64 81d458e 2de7fc4 31c977b bb106d5
d3f2c98 4e03b07 a13d4cf 8b73546 2742b96 — are **none of them ancestors of 36e33f3**. The server
predates all of them.

⇒ NOT TESTED, and deliberately not reported as passing: `graph_find` document titles,
`graph_health` population naming, the CMake false-drift alarm. A green from a stale server is
worse than no test.

★ The detector itself is the one thing that can be reported working: it fired unprompted, named
the remedy, and specified verification by TIMESTAMP rather than commit because "an unsuccessful
restart and a restart onto the same commit are indistinguishable by commit alone."

## ⛔ The document section reaches 2 of 4 surfaces

The briefs are FILES written by the post-commit hook from the current checkout — stamped
`GENERATED: 2026-08-21`, mtime 14:05:59 — so they are current-code output and bypass the stale
server. That is what makes this half of the round valid.

    brief.md          3 doc mentions    carries it
    brief.json        keys present      carries it
    brief.agent.md    0                 ⛔ nothing
    brief.onboard.md  0                 ⛔ nothing

Instrument note: the first probe searched for markdown headings and found none, because
`brief.agent.md` is `KEY: value`, not markdown. Wrong instrument, discarded. Re-run as a content
search with a positive control — `EXPORTS` returns 1 in the same file, so it can find what is there.

**Not correct-because-empty.** The candidates exist and are rendered elsewhere:

    brief.md:38  ## Linked document candidates
      "Ranked by link prominence, NOT a reading order — no explicit read-order directive was
       derived from this repo. Showing 2 of 93."
      - README.md — 9 document(s) link here …, last edited 2026-08-20 — evidence of relevance,
        not of accuracy
      - AGENTS.md — 6 document(s) link here …, last edited 2026-08-19

    brief.json   brief_schema_version 2 · read_first holds ONLY source entries now ·
                 linked_document_candidates populated · positional_document_fallback and
                 document_evidence present

⇒ The withdrawal, the rename, the schema discriminator and the age disclosure all shipped and are
visible — on two surfaces. The surface an agent reads FIRST shows nothing, with 2 candidates
rendered and 93 in the population.

⚠ Whether that is a dropped section or a deliberate token-budget omission is not established here
and is a one-line answer from inside the renderer.

## Second repo could not answer

`echoes_of_the_fallen`'s briefs are all stamped 2026-05-31 19:52 with no GENERATED line — three
months old, predating the stamp feature. It was NOT re-indexed to make it able to answer.
