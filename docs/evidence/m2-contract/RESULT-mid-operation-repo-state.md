# Result: a mid-rebase repo — the abandon rule fired, and there is no defect

Measurement for `PREREGISTERED-mid-operation-repo-state.md`, whose rules were committed at
`cef62140` **before** any of this was run.

## What was measured

A repo driven into a genuinely stopped rebase (`.git/rebase-merge` present, conflict markers on
disk), indexed there, then every surface a caller receives was searched for a mid-operation signal.

```
[FIXTURE PRECONDITION] repo is mid-rebase            : true
indexedCommit === head                              : true  (d0eb3df)
graphCurrency                                       : { state: 'current', reason: null }

  silent    graphCurrency.cause
  silent    graph_health (whole response)
  silent    graph_health.summary
  silent    graph_health verdicts / nextActions

[POSITIVE CONTROL] the conflicted path is in dirtyFiles : ["src/a.js"]
[NEGATIVE CONTROL] a clean repo mentions mid-operation  : false
```

Both controls pass, so the silence is a fact about the product rather than about the harness.

## The extension that decided it — and it is named as an extension

The preregistration asked about **disclosure**. Silence only matters if it costs something, so two
further probes asked whether it does. These were **not** preregistered and are labelled so.

**1. What does an index built mid-conflict contain?** Not both sides, and not nothing:

```
file on disk : <<<<<<< HEAD | fromMainBranch() | ======= | fromFeatureBranch() | >>>>>>> 52bae64
nodes        : File a.js · Function fromFeatureBranch · Module src.a
```

⇒ **One side, silently.** `fromMainBranch` is absent from the graph while its text is on disk. That
is a false absence on a symbol a reader can see — the product's core failure mode.

⚠ My probe printed *"the disclosure gap is cosmetic here"* on that result, because its check asked
`bothSides?` and the truth was a third case it had no branch for. **A binary check reports the wrong
conclusion when reality is neither of its two options**, and the printed verdict was discarded.

**2. Does the absence disclose it?** This is what decides the finding, and it does:

```
graph_callers("fromMainBranch")
  NO MATCH for "fromMainBranch". … INDEXED SCOPE: 1 file — not the whole repository.
  NOT COVERED: src/a.js (modified) — uncommitted, so not indexed.
  Commit or graph_index({force:true}) before treating this as absent.

graph_whereis("fromMainBranch")
  NO MATCH … READ THE SOURCE FILE (grep/Read) … 8 of those 9 have NO nodes in this graph at all

[POSITIVE CONTROL] the indexed side IS found : true
```

## ⛔ Verdict: the abandon rule fires. No defect, and nothing is added.

The preregistration said: *"If the emitted output already makes the state evident by other means …
then it is DISCLOSED and there is no defect. Record that and stop. Do not add a signal whose
information is already present."*

It does. The surface an agent reads **at decision time** names the file, says it is modified and
therefore not indexed, and tells the reader not to treat the absence as real. That is the same action
a mid-rebase notice would prompt — read the source, re-index — so a mid-operation banner would add
words without adding information.

⚠ **It says "uncommitted", not "mid-rebase".** Strictly less specific. It is kept anyway, because the
test is whether the reader is led to the right action, not whether the sentence is maximally
descriptive — and a second warning that changes no behaviour is the wall this project has already
torn out once.

⚠ **What survives as an observation, not a defect:** `graph_health` reports `currency: 'current'`
during a rebase. That is *true* — the graph does match HEAD — and HEAD being transient is corrected
automatically the moment the rebase ends, because `indexedCommit !== head` then reports `stale`.

## What this cost, and what it bought

Three probes and one preregistration to conclude **that nothing should change**. That is the rule
working: the abandon condition was written while the answer was unknown, and it fired against the
outcome I expected. ⇒ The 0-references-to-`MERGE_HEAD` finding from earlier in this arc is hereby
**closed as not-a-defect** rather than left open as a plausible-sounding hazard.

⛔ **Claim ceiling.** One platform, one backend (`rebase-merge`; `rebase-apply` untested), and the
population is the surfaces named in the preregistration. A surface outside that list is unmeasured,
not clean.
