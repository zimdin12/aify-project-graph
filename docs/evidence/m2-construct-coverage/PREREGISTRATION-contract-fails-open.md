# Preregistration — what does an agent receive when the M2 trust contract fails to build?

**Written:** 2026-09-02, before the fault was injected and before any output was observed.

## Why

All five absence consumers wrap the contract builder like this:

```js
let line = '';
try { line = '\n' + await buildAbsenceTrustLine({ ... }); }
catch { /* defensive */ }
```

(`callers.js:108`, `callees.js:122`, `impact.js:101`, `neighbors.js:46`, and `trace.js:355`, whose
comment says *"never block on trust-line failure"*.)

Read literally, a throw leaves `line = ''` and the verb returns a **bare absence** — `NO CALLERS` with
no TRUST line, no SCOPE, no NOT-MODELLED clause. That is the exact unsafe artifact M2 exists to
prevent, and the output would be **byte-identical to a build without the feature**.

This is not hypothetical here. `callers.js:95-97` records that this precise catch already hid a total
failure once: *"the scope note threw on every call and its catch returned '', so the feature was
inert and the output looked exactly as it had before."*

⚠ Reading the source is not measuring behaviour — a substitution that has falsified three of my
predictions in this project. Hence the injection below.

## Question

With `buildAbsenceTrustLine` induced to throw, what does the agent actually receive from an absence?

## Population

The five verbs above. Fault injected by mocking the module so the builder throws, exercised through
the verb functions on the existing fixture.

## Identity rule

- **Fails open** = the returned text still asserts an absence (`NO CALLERS` / `NO CALLEES` / …) while
  containing **no** `TRUST:` and **no** `NOT MODELLED`.
- **Fails closed** = the absence is withheld, or it carries an explicit notice that the trust
  contract was unavailable.

## Finding schema

One row per verb: `{ verb, absenceStillClaimed, trustPresent, noticePresent }`.

## Controls, same pass

- **POSITIVE — the un-faulted path carries the contract.** Without this, "no TRUST line" could mean
  the fixture never produced one, not that the fault removed it.
- **POSITIVE — the injected fault actually fires.** A mock that silently failed to apply would show
  the healthy output and be read as "fails closed". Verified by asserting the builder was called and
  threw.
- **NEGATIVE — the matcher can say ABSENT**, via a live matcher proved on both canaries.

## Claim ceiling

Measures behaviour under an **induced** fault. It does **not** estimate how often the builder throws
in production — that is a separate question, and a rare fault that silently removes a safety contract
is still a defect worth closing. Says nothing about verbs outside this population.

## Abandon rule

If the fault cannot be made to fire, report that the probe could not be constructed and conclude
nothing.

## Decided in advance

- **Fails open (bare absence)** → a real defect: the contract that exists to stop unsafe deletions
  disappears silently. Fix by emitting an explicit unavailability notice instead of `''`, so the
  agent is told rather than left to infer. Do **not** make it block the answer — a trust-line bug
  should not take the verb down.
- **Already carries a notice** → record it and leave the code alone.
