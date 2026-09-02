# The M2 trust contract failed OPEN — a bare absence, with no caveat, silently

**Date:** 2026-09-02
**Preregistered:** `docs/evidence/m2-construct-coverage/PREREGISTRATION-contract-fails-open.md`
**Fix:** `ABSENCE_TRUST_UNAVAILABLE` in `mcp/stdio/query/lsp-evidence.js`, consumed by all five verbs
**Gate:** `tests/unit/query/contract-failure-is-disclosed.test.js`
**Cost:** zero agent budget.

## What an agent received

With `buildAbsenceTrustLine` induced to throw, `graph_callers` returned, in full:

```
NO CALLERS for "alpha::Widget::render". Try graph_whereis(symbol="alpha::Widget::render", expand=true) for an overview.
```

No `TRUST:`. No `SCOPE:`. No `NOT MODELLED`. **A bare, unqualified absence** — indistinguishable from
an authoritative "nothing calls this", and byte-identical to a build without the feature.

That is the precise artifact M2 exists to prevent. All five absence consumers shared the same shape:

```js
let line = '';
try { line = '\n' + await buildAbsenceTrustLine({ ... }); }
catch { /* defensive */ }
```

**Not hypothetical.** `callers.js:95-97` already records this same catch hiding a total failure:
*"the scope note threw on every call and its catch returned '', so the feature was inert and the
output looked exactly as it had before."* The comment recorded the incident; the catch beside it kept
the behaviour.

## The fix, as preregistered

The catch now emits `ABSENCE_TRUST_UNAVAILABLE` — **one constant**, so five call sites cannot drift:

> TRUST: UNAVAILABLE — the trust contract for this absence could not be built, so this result is
> UNVERIFIED and its scope is unknown. Do NOT read it as evidence of no callers; confirm with
> `code_intel_references` or rg before any delete or rename.

⛔ It deliberately does **not** block the answer. A trust-line bug must not take the verb down. The
guard fails closed in the sense that matters — the agent is *told* the caveat is missing rather than
left to infer its absence from silence.

The remedy it names (`code_intel_references`) is in the default listing, so it does not itself create
the dead end the pointer gate exists to prevent.

## Population: all five, not the one I reached for

`graph_callers`, `graph_callees`, `graph_impact`, `graph_neighbors`, `graph_trace` — each verified to
still answer (the claim line survives) **and** to disclose. Fixing one and assuming the rest followed
is the mistake already made once with this exact contract.

## Controls and mutants

- **POSITIVE CONTROL — the induced fault actually fires.** A mock that silently failed to apply would
  produce the healthy output, which I would have read as "fails closed" — the wrong answer, arrived
  at confidently. Asserted directly.
- **F-1** — one consumer (`impact`) reverted to swallowing: **KILLED**, `'NO IMPACT — no edges found
  for "alpha…' to match /TRUST: UNAVAILABLE/`. Tree committed at `7cd2e74` before mutating.

⚠ F-1's first attempt was **NOT APPLIED** — `sed` failing on the `'\n'` escape, reporting `0=1` while
the suite passed 6/6. That pass was worthless. Re-done with Edit, mutation verified present. This is
the second time this exact sed-and-backslash failure has produced a meaningless green in this arc.

## Ceiling

Measures behaviour under an **induced** fault. It does **not** estimate how often the builder throws
in production — that is unmeasured, and a rare fault that silently removes a safety contract is still
worth closing. It says nothing about other `catch {}` blocks in the codebase, of which there are
more.
