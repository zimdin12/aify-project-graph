# Qt — a second gate behind the first

Carrying a language on framework refs unblocked five frameworks and did **nothing** for Qt. This is
why, and what it took to be confident the fix was safe.

## The second gate

A ref whose SOURCE is a name — `from_target` set, no `from_id` — is rejected outright unless its
relation appears in `SYMBOLIC_CHAIN_RELATIONS`:

    const SYMBOLIC_CHAIN_RELATIONS = new Set(['PASSES_THROUGH', 'INVOKES']);

`cpp_frameworks` emits `emit progressChanged()` as **CALLS from the enclosing function's NAME** —
exactly that shape. So its refs reached the dirty-edge sidecar carrying a perfectly correct
`language: 'cpp'` and were never looked at:

    {"from_target":"runTask","relation":"CALLS","target":"progressChanged",
     "extractor":"qt","language":"cpp"}

⇒ **Two independent gates, and fixing the first cannot reveal the second.** The language fix was
necessary and not sufficient, and nothing in its green result said so.

## Blast radius, measured before changing policy

`SYMBOLIC_CHAIN_RELATIONS` governs every extractor, so widening it is not a local edit. Counted
across five real repositories, with the probe positive-controlled in the same pass:

| repo | dirty edges | symbolic-source refs (any relation) |
|---|---|---|
| fmt | 1,894 | **0** |
| click | 3,298 | **0** |
| fast-route | 163 | **0** |
| p-queue | 86 | **0** |
| this repository | 18,194 | **0** |
| qt fixture (CONTROL) | 2 | **2**, both CALLS, extractor `qt` |

⭐ The control is what makes the zeros mean anything — a probe returning 0 everywhere is
indistinguishable from a broken filter until it returns non-zero somewhere it should.

⇒ Only repositories using Qt are affected at all.

## ⚠ Two early results looked like the change was wrong. Both were fixture properties.

**First fixture — an External SOURCE.** `class Worker { void runTask(); }` plus
`void Worker::runTask() {...}` produces **two** nodes labelled `runTask`, and `preferProximate`
returns null when candidates share a file. That ambiguity is genuine C++ structure, not a defect,
and External is the honest answer to it.

**Second fixture — External TARGETS.** `void progressChanged(int);` as a bare prototype creates no
node to bind to, so External is again correct.

**Third fixture, both sides defined once:**

    Function:runTask -> Function:progressChanged     bound
    Function:runTask -> Function:finished            bound
    Function:runTask -> External:thirdPartySignal    correctly external (declared, never defined)

**2 of 3 bound, and the third is the negative control in the same pass.**

⇒ I nearly reverted a correct change because the first two fixtures reported honest ambiguity as
failure. **When a fix "half works", check whether the failing half is the code or the fixture before
concluding either.**

## Regression controls

Reindexed with the gate open, all counts identical:

    p-queue      184 nodes / 384 edges     unchanged
    fast-route   489 / 1,343               unchanged
    fmt        6,735 / 14,855              unchanged, qt edges 0, externals 1,662 unchanged

⚠ **fmt matters most here** and was nearly skipped: `cpp_frameworks` detects on *any* C++ source, not
on Qt specifically, so fmt runs that extractor. It contains no `emit` statements, so it produces
nothing — but that had to be measured, not assumed.

## Tests

Four assertions on the real `resolveRefs`, and **2 mutants killed**:

- `CALLS` removed from the set — the original defect — goes red.
- The gate opened for *everything* goes red: `USES_TYPE` with a symbolic source must still be
  refused, or the set has stopped meaning anything.

Suite: 372 files, 3,007 passed, 4 skipped, 0 failed.

## Status

Qt signal edges now bind. That closes the last framework left broken by the resolver work — Express,
FastAPI, Django, Laravel, NestJS and Qt all resolve their routed or emitted targets to real symbols,
with third-party and genuinely-undefined targets correctly staying `External`.

Still open from that arc: laravel's middleware-chain `PASSES_THROUGH` is a declared uncovered site in
the enumeration guard (a mutant deleting its language survives), and rails/spring are covered by the
guard but have no end-to-end fixture indexed.
