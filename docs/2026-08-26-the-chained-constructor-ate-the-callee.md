# The chained constructor ate the callee

2026-08-26. The real defect underneath two withdrawn guards — found only after a reviewer refused the
guards and I stopped trying to classify a stripped label.

## The defect

`normalizeCallTarget` took the **first whitespace-delimited token** of the call's function text, then
the leaf of that. For a method chained onto a constructor the first token is the `new` keyword:

| source | emitted CALLS | |
|---|---|---|
| `new Date();` | `Date` | correct |
| `obj.bar();` | `bar` | correct (control) |
| `new Date().toISOString();` | `new`, `Date` | **`toISOString` lost** |
| `new Foo(1).bar();` | `new`, `Foo` | **`bar` lost** |
| `new Foo().a().b();` | `new`, `new`, `Foo` | **`a` and `b` lost** |

⚠ **The junk target was never the serious half.** A stub named `new` shows up in any census — that is
how this arc started. A *missing* call is invisible by construction: `graph_callers` on the real
method simply answered with silence, and nothing in the graph recorded that an answer was missing.

The fix splits on the member separator **before** the whitespace pass. The whitespace strip dated to
the extractor's first commit, with no test pinning it and no defect naming it.

## Effect, measured

Fresh full index of the same commit, extractor as the only variable, controls in the same pass:

| | CALLS | `new` | `toISOString` | `Date` (control) | `readFileSync` (control) |
|---|---|---|---|---|---|
| before | 8,705 | 96 | 1 | 89 | 120 |
| after | 8,968 | **0** | **85** | 89 | 120 |

+263 CALLS edges, and the controls do not move — so this is not a blanket increase.

## The second-order effect I had to chase down

Total edges *fell* (17,714 → 17,463) while CALLS rose, because `REFERENCES` dropped by 514. That
needed an explanation before any of this could ship.

**Mechanism, predicted and then verified:** the bogus CALLS targets were property names lifted off
chained expressions — `type`, `name`, `id`, `lines`, `label` — and each minted an External node. The
resolver's local-scope filter drops a bare lowercase `REFERENCES` target only when *no node anywhere
carries that label*. The bogus stubs were satisfying that check, so hundreds of local-variable
references looked resolvable and were kept.

    External node       before   after      control
    name                     1       0
    id                       1       0
    type                     1       0
    lines                    1       0
    label                    1       0
    readFileSync             1       1      unchanged

With the stubs gone the filter behaves as documented and drops them as the locals they are. **One
defect was propping up another.** The labels lost are classic local-variable names (`name`, `id`,
`lines`, `s`, `items`, `code`), consistent with the filter's stated purpose.

⛔ Not claimed: that every one of the 514 was noise. What is established is the mechanism, and that
the stubs which sustained them were themselves fabricated.

## How the evidence was misread twice before this

**First:** I saw 94 CALLS edges to an External named `new`, concluded "the extractor reads
`new Foo()` and `catch (e)` as call sites", and built a guard on it. Half true. `new` was real;
`catch` was `promise.catch(...)`, an ordinary member call, and the guard deleted those edges. Reverted
in `6d2d699` after review.

**Second:** I then measured a fresh index, read `new` = 0, and concluded the whole thing was
historical residue with no current defect. **Also wrong** — those index arms were built at `8f61239`,
where the guard was *still active and suppressing the exact two labels I was counting*. A fresh index
at `6d2d699` reports `new` = 96.

⇒ Twice in one arc, **a setup that could not exhibit the effect returned the same answer as a system
that does not have it.** The second time, the suppressing mechanism was one I had installed myself.

⇒ And the shape that finally exposed it — a *chained* constructor — was absent from every fixture
either I or the reviewer wrote. `new Date()` alone is correct; `new Date().toISOString()` is not. The
defect lived in the gap between a minimal example and real code.

## What this does not fix

The External admission defect is still open: `resolveTarget` can bind to a pre-existing External and
no admission policy runs, so pre-existence elevates a ref that creation policy would refuse. That
successor is specified separately and is not affected by this change.
