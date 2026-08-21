# Preregistration — `graph_find` must not claim it searched a layer it could not read

**Status: PREREGISTERED, NOT YET IMPLEMENTED.** Written before any code change, following the
pattern that earned its cost on `safeDirtyCount`.

## The defect, and it is larger than a bare `[]`

```js
function loadTasks(repoRoot) {
  const p = join(repoRoot, '.aify-graph', 'tasks.json');
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, 'utf8')).tasks || [];
  } catch { return []; }          // <- corrupt tasks.json reads as "no tasks"
}
```

A `catch` returning `[]` would be ordinary. What makes this a coverage defect is the caller:

```js
const results = {
  query: q,
  layers_searched: [...layerSet],     // <- an explicit CLAIM, in the structured result
  hits: { code: [], features: [], tasks: [], docs: [] },
};
```

⇒ With a corrupt `tasks.json`, `graph_find` returns `layers_searched` **including `tasks`**, and
`hits.tasks: []`. The consumer is told the tasks layer WAS searched and held nothing. Nothing was
read at all.

⛔ **This is the false-exhaustive shape**: a coverage claim that an instrument failure falsifies,
asserted in a structured field an agent can act on. It is not a display nit — `layers_searched` is
returned to the caller, not printed for a human to eyeball.

⚠ Plausibility of the induction in the wild: `tasks.json` is generated inside `.aify-graph`. A crash
or a full disk during a write truncates it. This is not an exotic state.

## Three states that are currently one

| world | today | should be |
|---|---|---|
| `tasks.json` absent | `[]`, layer claimed searched | honestly zero — but the layer's ABSENCE should be visible, not a silent empty |
| present, parses, N tasks | N | unchanged |
| **present, corrupt** | **`[]`, layer claimed searched** | **UNREADABLE — the layer must not be claimed as searched** |

The middle row is fine. The first and third are collapsed into it.

## Preregistered controls

Each names why its value differs between the honest and hostile worlds.

### C1 — the induction is proven to reach the catch, before its result is read
- Write a `tasks.json` containing `{"tasks": [` and assert `JSON.parse` on those bytes **throws**.
- **Discriminates because:** if the read degraded some other way — an empty file parsing to `{}`,
  say — the `catch` would never run and every assertion below would pass vacuously. This is exactly
  what nearly happened on `safeDirtyCount`, whose neighbour `getChangedFilesSync` swallows errors
  and returns `[]`; had the wrapped helper been that one, the fix would have changed nothing and its
  control would still have been green.

### C2 — a corrupt tasks file removes `tasks` from `layers_searched`
- **Honest world:** the layer is not claimed.
- **Hostile world (today):** `layers_searched` contains `tasks`.
- **Discriminates because:** the array membership differs, in the returned object.

### C3 — POSITIVE CONTROL: a VALID tasks file keeps the layer claimed and returns its hits
- **Discriminates because:** without it, C2 is satisfied by never claiming the tasks layer at all —
  which would pass the control that motivated the change while removing the feature.
- ⛔ This is the assertion that keeps the fix from being a lobotomy. `safeDirtyCount`'s C2 played
  the same role and it is the one I would most easily have skipped.

### C4 — an ABSENT tasks file is distinguishable from a CORRUPT one
- Absent is an honest zero; corrupt is an unknown. Collapsing them would fix one lie by telling
  another.
- **Discriminates because:** the two produce different disclosure, not merely different counts.

### C5 — the other layers are unaffected
- A corrupt tasks file must not remove `code`, `features` or `docs` from `layers_searched`, nor
  suppress their hits. A fix that degrades the whole verb to protect one layer is worse than the
  defect.

## Falsification, registered before the run

- corrupt file and `tasks` still in `layers_searched` → **the fix did not work**;
- valid file and `tasks` missing from `layers_searched` → **over-applied, feature removed**;
- any other layer's hits change under a corrupt tasks file → **collateral damage**;
- `JSON.parse` does not throw on the chosen bytes → **the control never ran**, and no result from
  this slice counts.

## Out of scope

- `collect_code_intel.js:106` (also HIGH in the adjudication) is a separate slice.
- `freshness/git.js:106` is DOCUMENTED AS INTENTIONAL and needs a ruling, not a patch.
- The MEDIUM and LOW tiers are untouched; the LOW tier I have argued should stay as it is.

## ⛔ CORRECTION, made BEFORE implementing — there are FOUR states, not three

I wrote "three states that are currently one". Verifying C1's induction turned up a fourth path
that does NOT go through the catch at all:

    JSON.parse(chr(123)+chr(125))  parses cleanly  ->  .tasks is undefined  ->  || [] gives []

So a tasks.json that is VALID JSON but not a tasks FILE reaches the same empty list by a different
route. It is a schema violation rather than a corruption, and a fix that only repairs the catch
would leave it lying.

| world | today | route |
|---|---|---|
| file absent | [] | early return |
| corrupt bytes | [] | catch |
| valid JSON, no tasks key | [] | the `|| []` fallback |
| valid tasks file | N | normal |

⇒ THREE different failures collapse into one honest-looking answer, by three different routes. A
control aimed only at the catch would have proven the catch fixed and left two paths lying — and it
would have LOOKED like a complete fix, because the test it was written against would be green.

⇒ C1 is therefore split: C1a proves the corrupt-bytes induction throws (verified: "Unexpected end of
JSON input"), C1b proves the no-tasks-key induction does NOT throw and reaches the fallback. They
are different worlds and must not share a control.

⚠ This is the second time preregistration has paid before a single line changed. On safeDirtyCount
it revealed that a neighbouring helper swallows what this one propagates. Here it revealed that the
defect has three routes and I had named one.

## ⛔⛔ SECOND CORRECTION — the FEATURES layer has the same defect, and worse

Before implementing I checked the sibling layer, because one fix is not a sweep. `loadFunctionality`
ALREADY does the right thing:

    catch (err) {
      return { version: null, features: [], mtime: 0, path, error: `${err.message} (schema: ...)` };
    }

It returns a TYPED result carrying an `error` field. The pattern I was about to invent for tasks
already exists one module over, and `loadTasks` is the odd one out.

⛔ BUT THE CALL SITE DISCARDS IT. find.js:257 reads only `overlay.features`. Nothing reads
`overlay.error`, anywhere in the verbs or the brief. So on a corrupt functionality.json:

  · loadFunctionality honestly reports the failure;
  · find.js takes .features -> [];
  · layers_searched STILL CONTAINS "features";
  · the consumer is told the features layer was searched and held nothing.

⇒ THIS IS THE WORSE OF THE TWO. With tasks, nobody knew the layer had failed. With features, the
information EXISTS, is correct, and is thrown away at the call site. An honest producer whose
consumer ignores it buys nothing — the same shape as a disclosure that no verdict reads.

⇒ SCOPE CORRECTED: the property is "layers_searched must not claim a layer that could not be read",
and its population is BOTH tasks and features. Fixing one and titling the commit after the property
would be a completeness claim over a population of one — the exact error this repo keeps paying for.

⇒ ADDED CONTROLS:
  C6  a corrupt functionality.json removes "features" from layers_searched
  C7  POSITIVE CONTROL: a valid functionality.json keeps it, with its hits
  C8  the two layers fail INDEPENDENTLY — corrupting one must not unclaim the other

⚠ C8 exists because the cheap implementation is a single try/catch around both loads, which would
unclaim both layers when one file is bad. That would be a fix that degrades the verb more than the
defect did.
