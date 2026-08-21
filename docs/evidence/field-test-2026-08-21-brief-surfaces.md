# Field test 2026-08-21 — server stale; the brief-surface finding was RETRACTED

> ⛔ **The original title of this file claimed the document section reached only 2 of 4 brief
> surfaces. That is FALSE and retracted below.** The title is corrected because a directory listing
> shows titles, and a reader who never opens the file would otherwise carry away the wrong claim.
> The commit subject of 1c4f94f still carries it and cannot be corrected without rewriting pushed
> history, so this line is the correction of record.

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

## ⛔ RETRACTED — the document section ships on ALL FOUR surfaces

**This file previously reported that `brief.agent.md` and `brief.onboard.md` carried no document
section. That finding is WRONG and is withdrawn.** It is corrected in place rather than deleted,
because a false product defect in an evidence directory is something a later reader acts on.

The compact renderers emit the token **`DOCS`**. Verified directly:

    brief.agent.md:77   DOCS (link prominence, not a read order):
                          README.md
                          AGENTS.md
                          showing 2 of 95 linked candidates
    brief.onboard.md:31 identical section, same content

Population disclosed, ranking caveat intact, cap stated — on the surface an agent reads first.

    surface            DOCS   "document"
    brief.md              0        3
    brief.agent.md        1        0
    brief.onboard.md      1        0

⇒ The probe counted occurrences of "document". `DOCS` does not contain that substring, so the
matcher could not fire on correct output. `brief.md` scored only because it spells the words out
as "Linked document candidates".

### ⛔ The positive control was on the wrong thing

The probe was controlled by grepping `EXPORTS`, which returns 1 in the same file. That proved the
instrument could find **a** string that was present. It did not prove the instrument could find
**the target** string.

**A positive control on a convenient token is not a control on the class.** The control has to be
the thing being claimed absent — here, the string the producer actually emits.

### And the confirming read was the same instrument twice

The finding was "independently verified" by re-running `grep -ci "document"` across the four files.
That is the same matcher class, so it supplied no independence: two reads of one source are one
instrument read twice. What broke it open was reading the RENDERER — both compact renderers hold
the section gated on `if (docCands.length)`, and `requireDocumentView` returns the same view for
every surface, making "compact has no candidates" impossible by construction.

⇒ **When a finding says A SECTION IS ABSENT, grep the PRODUCER for the string it actually emits
before believing a consumer-side probe.**

## Second repo could not answer

`echoes_of_the_fallen`'s briefs are all stamped 2026-05-31 19:52 with no GENERATED line — three
months old, predating the stamp feature. It was NOT re-indexed to make it able to answer.
