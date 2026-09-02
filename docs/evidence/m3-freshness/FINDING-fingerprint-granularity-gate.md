# FINDING — M3b's precondition, answered. The granularity is per-file, and that is the smaller problem.

The plan gates M3b on one check, before any design:

> Check structural-fingerprint granularity **FIRST**; per-file would produce too many false
> reconfirms.

Answered from the artifact, not from memory.

## Granularity: per-FILE, confirmed by the schema

```sql
CREATE TABLE IF NOT EXISTS structural_fingerprints (
  file_path TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL
);
```

One opaque hash per file. **838 rows** in this repo's graph. There is no per-symbol or per-anchor
fingerprint anywhere, so the plan's premise is correct: per-file is the only granularity available.

## How bad the over-firing would be — measured

Across 695 files carrying symbols (3,012 `Function`/`Method`/`Class` nodes):

| statistic | symbols per file |
|---|---|
| median | 3 |
| mean | 4.3 |
| p75 | 5 |
| p90 | 9 |
| max | 49 (`code-intel/lsp-client.js`) |

A claim anchored to one symbol in a file would be reconfirmed whenever ANY symbol in that file
changes structurally. At the mean that is **~4.3 claims woken for 1 real change (~77% false)**, and
in the p90 tail ~89%. The plan's worry is quantified and confirmed.

## ⭐ But the larger problem is the opposite one, and it is by design

`mcp/stdio/ingest/fingerprint.js` hashes the structural SHAPE of a file — per-symbol
`{type, label, qname, signature, parentClass, decorators}` plus the complete outgoing ref set
`{relation, fromOwner, fromTarget, target}` — and **deliberately excludes bodies**. Its own header:

> A body-only / comment / whitespace / literal-value edit leaves this fingerprint UNCHANGED
> (cosmetic).

So an edit that flips a comparison, changes a constant, or reorders logic **does not move the
hash**, unless it also adds or removes a call. That is the most common way a *behavioural* claim
goes out of date, and it is invisible to this substrate at ANY granularity — finer per-symbol
fingerprints would not help, because the insensitivity is to bodies, not to scope.

⇒ **M3b splits in two, and only one half is servable today:**

- **Structural claims** ("X has these callers", "X's signature is …", "nothing calls X") — the
  fingerprint moves when they go stale. Servable, at the cost of the false-reconfirm rate above.
- **Behavioural claims** ("X validates its input", "X returns null on failure") — the fingerprint
  is designed not to move. **Not servable on this substrate at all.**

## ⛔ A defect I suspected and did NOT find — recorded so nobody re-suspects it

The header says `node.id` was removed from the symbol shapes because a site id is now a BYTE SPAN,
which would smuggle position into a position-free fingerprint. The ref set folds `from_id`, which is
also a node id, so the same defect looked present one block below the comment describing it.

It is not. `from_id` is mapped through `ownerShape` to `shape#ordinal`, where the ordinal orders
same-shape twins by `site_start_byte`. A comment insertion shifts every offset but preserves ORDER,
so cosmetic edits stay cosmetic while same-shape twins stay distinct. The code is correct and more
careful than the concern. **Checked rather than assumed, and reported as no-defect.**

## Claim ceiling

The symbols-per-file distribution is measured on THIS repo (JavaScript, 695 files). It is not a
prediction for a C++ codebase, where files are typically larger and the false-reconfirm rate would
be worse, not better. Nothing here measures how often claims actually go stale — only what this
substrate can and cannot detect when they do.
