# PREREGISTRATION — census of absence-shaped answers and their scope statements

Written before the census was built or run. M2's stop condition is *"every absence-shaped answer
carries a scope statement an agent can act on"*, and that is a claim about a POPULATION. I cannot
assert it from the four call sites I happen to have edited.

## Population

Every verb in the real registry, `mcp/stdio/tools/schema.js` — **derived from the registry, never
from a hand-kept list**, because a parallel list is a defect with a delay on it. The census reports
the registry's own count rather than assuming the plan's figure of 43.

Within that, the sub-population under test is verbs whose implementation can emit an
**absence-shaped answer**.

## Identity rule

An **absence-shaped answer** is an emitted string that asserts nothing was found — matched on the
verb's own source, not on my expectations. The rule is deliberately syntactic:

- an emitted literal matching `/NO [A-Z ]+ for|NO MATCH|no match|NO CALLERS|NO CALLEES|not found/`
- reached on a path where the result set is empty

A **scope statement** is text accompanying that answer which names the boundary of what was
searched — the spine, its coverage, the relations consulted, or the compile-DB state. Present or
absent is decided by whether the absence path reaches one of the known scope producers
(`buildAbsenceTrustLine`, `unsearchedRelationNote`, `noMatchMessage`), established by reading the
call graph, not by grepping for adjectives.

## Finding schema

One row per absence path: `{ verb, file, absenceLiteral, scopeProducersReached[], verdict }` where
verdict is `HAS_SCOPE` / `NO_SCOPE` / `N_A_NO_ABSENCE_PATH`.

## Claim ceiling

This census reads SOURCE. It may state which absence paths do or do not reach a scope producer.

It may **NOT** state:
- how often agents hit any path (that is runtime, unmeasured);
- that a reached producer actually produced useful text in a given call (reachability is not output —
  a producer whose every branch returned '' would still be "reached", the exact defect recorded at
  `callers.js:93` where a scope note threw on every call and its catch returned '');
- that a scope statement is *actionable*, which is a judgement, reported separately and marked as
  such.

## Controls, in the same pass

- **POSITIVE:** `graph_callers` must come back `HAS_SCOPE`. I wired it this session; if the census
  cannot see it, the census is broken, not the verb.
- **NEGATIVE:** a verb with no absence path must come back `N_A_NO_ABSENCE_PATH`, never `NO_SCOPE`.
  Without this, "everything has scope" and "the detector cannot tell them apart" look identical.
- **REGISTRY CONTROL:** the verb count is read from `schema.js` and printed. A count of 0 means the
  registry read failed and every downstream verdict is void.

## Abandon rule, preregistered

If the census cannot distinguish `HAS_SCOPE` from `NO_SCOPE` on the four call sites I already
changed, it is measuring nothing and is abandoned rather than reported with caveats.
