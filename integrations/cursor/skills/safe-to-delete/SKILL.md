---
name: safe-to-delete
description: "Use for 'is this dead code', 'can I delete X', 'is anything still using this', or before a rename that changes a symbol's name. Builds a precise lead set, then proves absence the only way it can currently be proved, and refuses to certify what no tool here can certify."
---

# Safe to delete

<!-- APG-SAFETY-CONTRACT: 2026-08-19-exhaustive-withheld -->

Deleting live code is the most expensive mistake this toolset can help you make, and the one it
is most likely to be blamed for. Read the next section before you plan around any verb.

## What this toolset can and cannot tell you

⛔ **No verb here can certify that a symbol has no callers.** Not one. As of 2026-08-19 the
`evidence.exhaustive` flag is withheld on every reference and definition answer, with cause
`index_population_unattested`, and the zero caller shape never carried it even before that.

The reason is worth knowing, because it tells you what to check instead. A compile database
lists which translation units clangd MAY index. It never reports which it DID. A file present in
the database can fail to compile, a missing include path is enough, and its callers then become
invisible while background indexing still reports idle. Measured against real clangd: two files,
both in the database, one uncompilable, and the reference query returned one caller of two while
reporting high confidence.

✅ **What it can tell you is worth having.** Every location `code_intel_references` returns is
compiler resolved. Those callers are real, they are not text matches, and you should not spend a
grep re-checking them. Published measurement puts that precision at 1.00 against 0.76 for grep.

So: the tools are for finding callers, and rg is for proving there are none.

## Steps

1. **Check the ground first.** `graph_health`. If the graph is stale or there is no code intel
   collection, you already know your caller sets are heuristic, and you can stop reading the
   evidence object on every later call.

2. **Gather leads, cheapest first.**
   - `code_intel_references(symbol)` for compiler resolved call sites. Pass `waitForReadyMs`
     (25000 on a cold session) or a correct answer comes back unattested.
   - `code_intel_hierarchy(symbol, kind="callers")` for the transitive tree. One hop will not
     find what dispatch hides.
   - For a C++ virtual, `kind="subtypes"` on the OWNING CLASS, not on the method. On a method it
     resolves to the return type.
   - `graph_impact(symbol)` for the wider heuristic radius: type users, tests, overrides.

3. **If any lead is non-empty, stop.** You have your answer and it is "no". Report the call
   sites and finish. Everything below is for the case where the tools found nothing.

4. **An empty result is not an answer yet.** Read the `cause` on the evidence object and say
   which one you got. Then verify by hand, because that is currently the only sound method:
   - `rg -n "\bSymbolName\b"` across the repo, including tests, generated code and docs.
   - The names grep will not match: a string in a config, a dynamic dispatch table, a symbol
     exported to another language, a reflection or DI registration, a build flag that compiles
     the caller out on your platform.
   - For C++, check whether the file is even in `compile_commands.json`. If it is not, the
     language server never saw it.

5. **Decide, and say what backs the decision.**
   - "Deleting. rg found nothing across N files, the symbol is not exported, and no config
     references it by string." That is a real basis.
   - "Not deleting yet, the tools are clean but this is a virtual with a partial compile
     database." That is also a real answer and it is worth more than a wrong deletion.

6. **Prefer a reversible proof.** Rather than deleting, make it fail loud: remove the export,
   mark it deleted, or throw inside it, then build and run the tests. A build error names the
   caller that every search missed. This is the step that turns an argument into evidence, and
   it is usually cheaper than the discussion about whether the search was thorough enough.

## What to hand back

- The decision, and the single fact it rests on.
- Where the leads came from, with `file:line`, marked compiler resolved or heuristic.
- The exact `rg` you ran and what it returned. A search that finds nothing is a result, and it
  is only meaningful if the reader can see the pattern you used.
- The `cause` from the evidence object, copied verbatim.
- What you did not check, named. "I did not check the Lua bindings" is useful. Silence is not.

## Renames

A rename is a delete with extra steps, and the same limit applies to definitions: a definition
request can fall back to a DECLARATION while the field is still called definitions, so the
`resolutionKind` on the evidence object reads `definition_or_declaration`. Treat a rename as
this skill plus a compile.
