---
name: blast-radius
description: "Use for 'what could this break', 'blast radius of X', or reviewing a diff you do not trust yet. Finds the breakage that grep will not show you, and proves the one fact the change is safe because of by running code instead of writing it up."
---

# Blast radius

<!-- APG-SAFETY-CONTRACT: 2026-08-19-exhaustive-withheld -->

Find what a change breaks somewhere else, before it ships.

Listing the callers is not the job. You can grep those in a second, and measurement says grep
is already at 100% on symbol lookup. The job is the breakage grep will not show you: the JSON an
API returns, a DB column, a wire format, a virtual dispatch, a feature flag, code three hops
downstream in another language.

This skill uses aify-project-graph where it earns its place and says plainly where it does not.

## The trap this skill exists to stop

A blast-radius writeup that sounds right is worthless. It reads as convincing whether or not it
is true. Do not hand back the writeup. Find the one or two facts the whole thing depends on, and
prove them by running code.

## How sure are you

For each fact the change's safety depends on, get it as far down this list as is cheap, and say
where it stopped.

1. You said so. Worthless on its own.
2. The graph says so. `graph_impact` or `graph_callers` found an edge. This is a LEAD. Tree
   sitter extraction undercounts C++ virtual and cross-TU dispatch, and edges carry `prov=`.
   `EXTRACTED` and `INFERRED` are guesses that were often right.
3. The compiler says so. `code_intel_references` returned the location, and its `evidence`
   reports `precision: compiler_resolved`. That location is real. Do not re-grep it.
4. You ran it. A script or test that calls the real code and fails loud if you are wrong.
5. You reproduced it in the running app.

Any safety fact you cannot get to step 4, say so out loud. Do not write it up as settled.

⛔ **Steps 2 and 3 raise PRECISION and never raise COMPLETENESS.** The evidence object reports
`completeness: floor` and `indexPopulation: unattested`, and it means it: the compile database
selects which files the language server may index, never which it did. A file in it can fail to
compile and its callers vanish while indexing reports idle. So the graph can tell you a caller
is real. It cannot tell you that you have them all, and it will not pretend to.

## Steps

1. **Read the change.** The diff, the symbols it adds, changes and deletes, and what it now does
   differently, including the part the diff does not spell out. `graph_explain_diff` takes a git
   range or defaults to the working tree, and returns CHANGED, AFFECTED one hop, LAYERS, RISK
   and TESTS.

2. **Find the one fact it is safe because of.** Most changes that look frightening are safe
   because of a single fact, like "this only drops cache entries that were already dead". Find
   that fact. If it holds, most of the scary cases die at once. Spend your time here, not on a
   long list of maybes.

3. **Go where grep stops.** This is the part worth spending calls on.
   - `graph_consequences(target="X")` for the cross-layer radius: contracts, features, open
     tasks, adjacent tests, history. Read `field_provenance` on every field. An absent INFERRED
     entry is not evidence of absence.
   - `code_intel_hierarchy(symbol="X", kind="callers")` for the transitive tree and
     `kind="subtypes"` on the owning CLASS for virtual overrides. A single hop will not find
     what dispatch hides.
   - `graph_trace(from, to)` when you suspect a path and want the hops inlined.
   - Then leave the tool: the pinned version of the library you call, a local patch, when things
     run (microtasks, teardown), the wire format, the DB column, the flag.

4. **Be honest about each risk.** Give it a real chance of happening and a real cost if it does.
   Keep the risks you confirmed. List what you checked and cleared separately, because a search
   that finds nothing is an answer worth reporting. Cite a real `file:line`. Never invent a
   caller or an API.

5. **Prove the one fact.** Write a script or test that runs the real code, run it, paste what
   happened. If you cannot prove it cheaply, mark it unproven. Do not round up.

## What to hand back

- **What it does.** What changed, including the part that is not obvious.
- **The one fact it is safe because of.** State it, say which step you got it to, show the
  proof. If you could not prove it, write unproven.
- **Risks.** Only the real ones. Each names how it breaks, the `file:line`, how likely and how
  bad, and how to check.
- **Cleared.** What you checked and why it is fine.
- **What the tools could not see.** Copy the `cause` from any `evidence` object you relied on.
  `index_population_unattested` means the caller set is a floor. This section is not a
  disclaimer, it is the part that tells the reader which risks you could not have found.
- **Before you merge.** The cheapest test that catches the real bug, including the script.

## When not to use this

If the question is "where is X defined" or "who calls X", call the verb directly. Wrapping a one
call question in a six step method wastes the budget this skill needs for step 3.
