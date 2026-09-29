# A multi-line anchor could not find code that had not changed

**Named by dashboard-manager, 2026-09-29**, from a live instance on their own tree: two anchors stopped
resolving with the code they name completely unchanged, because the file had become CRLF and every `\n` in
a committed multi-line span matched nothing.

**Answer here: the same defect exists, and it was LATENT rather than firing.** Fixed, with both halves
watched red.

## Why the verdict is the expensive part

`resolveAnchor` returns `absent`, which reads as **"a stale spec pointing at deleted code"**. It sends you
looking for a refactor that never happened, and the honest-looking repair is to re-aim the anchor at
whatever is there now — **silently replacing one measurement with a different one.** The miss is cheap; the
plausible wrong story it tells is not.

## Measured, at the size it actually was

`scripts/lib/anchor.mjs:52` matched with a raw `source.indexOf(anchor, pos)` — no line-ending handling.

| fact | value |
|---|---|
| declared self-review specs | 35 |
| specs whose anchor is **multi-line** | **10** |
| multi-line anchors containing CR | 0 |
| ...of those 10, how many target a **CRLF** file | **0** |
| resolution states across all 35, before the fix | `{ unique: 35 }` |
| tracked `.js`/`.mjs` files: pure CRLF / pure LF / mixed | **122 / 799 / 6** |

⇒ So nothing was broken **today**, and the green was **luck about which files those ten anchors point at**.
122 CRLF files exist; one Windows editor touching any of the ten turns a passing spec into a false
"stale spec" report.

⚠ I also had to correct myself here: I first stated the worktree was all-CRLF, from three sampled files.
It is mixed, and the mix is precisely why the defect is latent rather than live.

**Proven on a real anchor**, by re-resolving it against a CRLF copy of its own file:

    subject: mcp/stdio/query/verbs/symbol_lookup.js
    POSITIVE CONTROL  as-is (LF file):       unique
    THE DEFECT        same file as CRLF:     absent   <- code byte-identical, only line endings differ
    THE FIX           anchor converted too:  unique
    NEGATIVE CONTROL  a fabricated anchor:   absent

## The fix, and the hazard it could have re-opened

Both spellings are counted into **one** occurrence list. A fallback — try the raw anchor, then the
converted form — would accept whichever matched first and could report `unique` for a span appearing once
as LF and once as CRLF in a mixed file. That is **the duplicate-anchor hole this module exists to close,
re-entering through the fix for a different hole.** There is an arm for it.

Normalising to LF before converting makes it idempotent: an anchor already carrying `\r\n` must not become
`\r\r\n`.

## ⛔ And the part I nearly shipped wrong

The comment I first wrote said splicing by `anchor.length` "would leave a stray `\r` behind on every line".
**It does not.** Measured:

    matchedLength 30, anchor.length 29
    WITH anchor.length (the bug): "function keep() {\r\n  const merged = 3;;\r\n  return a + b;\r\n}\r\n"
    WITH matchedLength (correct): "function keep() {\r\n  const merged = 3;\r\n  return a + b;\r\n}\r\n"
    bug has lone CR: false

Splicing k bytes too few leaves **the last k bytes of the span** — a doubled `;`. **No lone CR is
produced**, so the CR-shaped assertion I had written was structurally blind to it. A comment describing one
failure and a test checking a different one, both looking right.

⭐ **It was caught only by mutating and watching**: reverting the splice to `anchor.length` left every
assertion in that arm **green**. The arm now compares the whole resulting string against an independently
built expectation, which an off-by-k splice cannot survive. The arm's title was also corrected — it claimed
"leaves NO stray carriage return", a property nothing there tests.

## Red watches

| mutation | result |
|---|---|
| CRLF variant removed (the original defect) | **4 arms red**; positive control, negative control and single-line arms stayed green |
| splice reverted to `anchor.length` | **byte-for-byte arm red** — and, before that arm existed, *nothing* caught it |

## One existing test edited, and why

`tests/unit/scripts/anchor-addressability.test.js:164` asserted the exact result object
`{ state: 'unique', index: 0 }`. `resolveAnchor` now also reports `matchedLength`, so the assertion was
incomplete rather than wrong — its subject, non-overlapping counting, is unchanged.

Kept **exact** rather than loosened to `toMatchObject`: the new expectation
`{ state: 'unique', index: 0, matchedLength: 2 }` additionally pins that a 2-byte anchor matched 2 bytes.

⚠ And the field genuinely belongs on the resolver rather than the mutator. `applyAnchor` re-deriving the
matched length would be a **second search that could disagree with the resolution** — the exact thing this
module's own header forbids.

## Verified after

- `tests/unit/scripts/` — 39 files, 424 tests, all pass
- all 35 declared specs still resolve `{ unique: 35 }` against the real tree

## The rule, which is theirs

> **Any check that matches text against a file has to match in the file's own encoding, not in the one the
> check was written in.**

Population, predicate, expectation, encoding. Same root as their earlier carriage-return bug, where a
control regex could not find a comment in a CRLF file because `.` does not match `\r` — three sets, 23
rows, unrunnable and reported as never run.
