# The LSP location contract — frozen BEFORE the corrupt wire payload is observed

⚠ **Written before capturing the wire response, deliberately.** If the contract were written after
reading the corrupt payload, the payload would define its own oracle: every predicate would be
shaped to the one failure already seen, and the next distinct corruption would pass. What follows
is derived from what an LSP location *is*, not from what this bug *did*.

The stored record's corruption has been observed (`file` = an MSVC include **directory**), but the
**wire** response and the client-return object have **not**. Those two boundaries are captured only
after this document is committed.

## The predicate: one internally coherent location

A code-intel location record is valid only if **all** of the following hold. The point is
coherence — three individually plausible fields assembled from different objects is exactly the
failure mode this contract exists to catch.

1. **Shape.** The response object is either
   - `Location` — `{ uri, range }`, or
   - `LocationLink` — `{ targetUri, targetRange | targetSelectionRange }`.

   Any other shape is `UNKNOWN`, never coerced.

2. **Single provenance.** The URI and the range are taken from **the same response object and the
   same shape**. Never a URI from one object and a range from another, and never a URI from the
   *request* paired with a range from the *response*.

3. **The URI resolves to a FILE.** Either
   - the exact frozen source member it claims, repo-relative; or
   - a typed external/system **file** — `outside_project_root` is a legitimate outcome for a system
     header, but it must still name a file.

4. **The range is valid in that exact document.** Start/end within bounds for the document the URI
   names — not merely well-formed numbers.

5. **The text at the range identifies the expected symbol token.** Reading the bytes at that span
   in that document must yield the identifier the record claims. A plausible line number is not
   evidence that it points at the symbol.

6. **⛔ A directory URI paired with an identifier range is invalid by construction.** Not "unusual"
   — impossible. No conforming LSP location can name a directory and simultaneously carry a
   character-precise identifier span. Any record in that state is a defect regardless of how
   plausible its other fields look.

## Boundary capture — two immutable receipts

Captured for the **same** request, so a divergence localizes the fault rather than describing it:

| # | boundary | what it proves |
|---|---|---|
| 1 | raw JSON-RPC response, **before** `LspClient` normalization | what clangd actually sent |
| 2 | the `LspClient` return value, **before** `cpp-clangd` record construction | what decoding produced |

Bound to each capture: request id and method, request params, source file hashes, compile-DB hash,
clangd binary hash and version, `cwd`, and the receipt's own hash.

**Localization rule, fixed in advance:**

- wire wrong → clangd / request / compile-DB side
- wire right, client object wrong → `LspClient` decoding or normalization
- both right, stored record wrong → `cpp-clangd` record construction

## Tests that follow the capture

1. **Replay test** over the frozen response — must go **RED against the current constructor**. Pins
   the defect cheaply and permanently, without needing clangd to reproduce it.
2. **Live integration test** proving the real transport still satisfies this same predeclared
   contract. Without it, a synthetic payload becomes its own authority and the replay test would
   keep passing after the transport drifted.

## What stays untouched

`paths.js` remains **exonerated** — proven correct by direct test on long-form roots, 8.3 short-form
roots, and a genuine system header, and it keeps its existing positive controls. `symbol_id` is
**not** parsed to reconstruct `file`; that would mint a second positional authority and hide the
producer defect. No layer is repaired until the first divergence boundary is established.

## Claim ceiling

This contract governs C++ code-intel location records produced by the clangd provider. It is not a
statement about other providers, and satisfying it does not make a record semantically *correct* —
only internally coherent and pointing where it claims.
