# Field test 2026-08-22 — probes 1 and 2 driven around a stale server

Asked to look for OVER-correction first: the new behaviour firing when it should not. Looked, in
both reachable fixes, from both sides. Not found. Probe 3 (the P0) not reached.

## Server still stale — same process as yesterday

    buildId 36e33f3 · startedAt 2026-08-20T01:56:42.176Z   (byte-identical to the 21st)
    5b054ae NO · 9b70ac0 NO · 9c94586 NO      none is an ancestor of 36e33f3

A new session may bind to a newer server; this session has been alive continuously since before
those spawned, so it still holds the process from the 20th. Everything MCP-mediated stops.

⇒ The fixes are in the checkout, so they were driven by importing the product module directly —
the same route that made the lc-api answer valid. Product code, not a re-implementation.

## Probe 2 · `layers_searched` — holds, including the C8 over-correction case

Throwaway git repo, real `graphFind`, one layer corrupted at a time:

    BASELINE both valid        [code,features,tasks,docs]   layers_unavailable key ABSENT
    tasks CORRUPT              [code,features,docs]         "unparseable: Expected ':' …"
    features CORRUPT           [code,tasks,docs]            "unreadable: … (schema: …)"
    tasks MALFORMED (no key)   [code,features,docs]         "parsed, but carries no `tasks` array"
    both valid AGAIN           [code,features,tasks,docs]   key ABSENT

⇒ Corrupt one, the healthy sibling is STILL CLAIMED — in both directions. Clean run carries no
`layers_unavailable` key, so no noise. And it RECOVERS: restoring the files returns all four with
the key gone, so nothing latches.

The third route (valid JSON, no `tasks` key) is distinguishable from corrupt bytes BY ITS REASON
STRING, not merely caught — the case a catch-only fix would have missed.

## Probe 1 · SNAPSHOT `dirty=` — three states confirmed distinct

    clean tree                    dirty=0     the over-correction case: NOT `?`
    two TRACKED files modified    dirty=2
    not a git repository          dirty=?
    path that does not exist      dirty=?

`??` rather than `||` is doing its job: the commonest honest state still renders 0.

⚠ To confirm rather than a defect: an UNTRACKED new file in an otherwise clean repo also reports
`dirty=0`. Read as deliberate — the field counts tracked files, and `graph_health` separately says
"0 tracked (+1 untracked)". Noted because `dirty=0` on a tree that does contain a new file is a
true statement about tracked files that a reader may hear as a statement about the tree.

## ⚠ The instrument failed first, twice

Probe 2's first run returned `layers_searched=null` in EVERY case INCLUDING baseline. `graphFind`
returns a JSON **string**, not an object. The baseline control caught it: a null on the healthy
case cannot be the feature. Running only the corrupt cases would have reported "the layer
vanished" as a pass.

In probe 1, the first pass produced only `0` and `?` — an untracked file does not move the count —
and nearly supported a three-state claim from two observations. `N` required a TRACKED edit.

⇒ Both caught by the same discipline: run the case that must NOT fire, in the same pass.

## What this is not

A negative result on 2 of 3 fixes, not a clean bill. Probe 3 (the P0 rebuild) was NOT reached, and
it is the one where over-correction — a rebuild on every ordinary run — would cost the most.
Nothing was tested through the server.
