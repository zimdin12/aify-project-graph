# G8 — bounded mutant receipt

Immutable raw artifacts from the single authorized run. **Do not edit.**

| field | value |
|---|---|
| preregistration | `tests/self-review/preregistrations/G8.json` |
| authorized commit | `c748f4231a51e32d9fa023127efb16ff8a95aee9` |
| authorized tree | `4ab0bff50eb661598fe876629f93d042fd84a650` |
| referee | the reviewer, approval msg `1787266025666-e83bb59d` |
| run id | `cd87e1c6-9d70-4565-95ab-768e30ae6590` |
| carrier | detached disposable worktree, `node_modules` by junction, disposed after |

## Result

    verdict          FAILURE_OBSERVED_UNATTRIBUTED
    baseline exit    0
    mutant exit      1
    anchor offset    22963      (matches the preregistered index exactly)
    pre  sha256      7cce7bda071de74b316e5061...
    mutant sha256    b8002e45010a1d9e096abbc4...
    restored sha256  7cce7bda071de74b316e5061...   byte-identical
    failing cases    1 of 1 · exactly 1 message · contains the preregistered predicate
    nonCaseErrors    0 · fileErrors 0

## ⛔ What this does NOT establish

- **Not** that the wire name reaches `graphCollectCodeIntel`. That claim is expressly withdrawn by
  `tool-routing-identity.test.js:177-228`; a request-derived lookalike is known to survive.
- **Not** runner, provider, import or replay identity.
- **Not** `v3_witnessed` — body attribution is open, a `beforeEach` throw occupies the same slot as
  a body assertion.
- The downstream provider (`/cpp-clangd/`) and mint-uniqueness assertions were **UNEXECUTED**.
  Vitest stops a case at the first throw. They have no verdict and must not be reported as passing.

## What it does establish

For **this constant forgery** — a registered handler satisfying invocation, success, response shape,
provider shape and fresh mint formatting, but not deriving request-bound repository identity — the
repo-path discriminator rejects the response. That discriminator is load-bearing against this
forgery. Nothing wider.
