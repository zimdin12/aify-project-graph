# D2 — FAILURE_OBSERVED_UNATTRIBUTED

Immutable artifacts from the single authorized run. **Do not edit. Not rerun.**

| field | value |
|---|---|
| preregistration | `tests/self-review/preregistrations/D2.json` |
| authorized commit / tree | `6d9fd5a` / `647c92e` |
| referee | the reviewer, approval `1787280366371-a8dad722` |
| run id | `f694cd25-43f6-429d-87d0-dec5c4fb253a` |

## Every acceptance predicate, measured

    baseline         exit 0 · 10 cases · 0 failed · 0 nonCaseErrors
    mutant           exit 1 · 10 cases · 1 failed · 0 nonCaseErrors · 0 fileErrors
    anchor offset    1767  — exactly the preregistered value
    failing case     ★★ a SECOND same-key call joins the in-flight start, it is not told a lie
    messages         1
    message          "the joiner must receive a usable url, never undefined:
                      expected undefined to be truthy"
    :256 / :332      GREEN — the different-key cases, as the population argument predicted
    target restored  byte-identical · terminal porcelain empty · worktree disposed

## ★ The falsifiable sub-prediction held

**No `EBUSY`. No second message.** Predicted *before* the run: D2's mutation makes the second call
return early, so it never starts a rival dashboard, no extra handle is opened, and teardown has
nothing locked.

⇒ Had `EBUSY` appeared, the leak model behind the D1 diagnosis would have been wrong. It did not, so
that model survives one deliberate attempt to falsify it — which is a different and better thing
than never having tested it.

## ★ The discriminator worked exactly as reasoned from source

`expected undefined to be truthy` is the value difference the preregistration argued for: the
pending marker `{ pendingStart, repoRoot, joinable }` carries **no `url`**, so the mutated
fall-through returns `undefined` where the honest join branch returns a real url.

⇒ This is what D1's predicate could not do. There, both worlds produced the same url and the
assertion could not tell them apart. Here the value differs *because of* the mutation.

## ⛔ What this does NOT establish

- **Not** teardown visibility, ownership, or release — untouched by this arm.
- **Not** that the marker is published early enough. That is D1's separate question and remains
  unwitnessed.
- **Not** `v3_witnessed`. Body attribution stays open: a `beforeEach` throw occupies the same slot
  as a body assertion, so `FAILURE_OBSERVED_UNATTRIBUTED` is the ceiling.
- The downstream URL-equality and start-count assertions were **UNEXECUTED** — vitest stops the case
  at the first throw. They have no verdict and are not reported as passing.

## Ledger

**NOT promoted in this commit.** The referee requires the receipt before promotion. D2 remains
`v3_runnable_unwitnessed` until ruled.
