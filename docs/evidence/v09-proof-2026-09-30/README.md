# v0.9 proof, provider side — run live on 2026-09-30

The dashboard's v0.9 claim: **a commit that changes an anchored function's signature or what it calls or
references marks its feature stale, and a re-confirm of that anchor alone clears it.**

Before this run it had never happened on a real system. The live dashboard database held **0 rows in
`watch_stamps`**: the service only accepts a baseline supplied by the provider, and no provider had ever
supplied one. This directory is the provider's half, run against a scratch dashboard service and a scratch git
repository, with the real provider code and nothing written to the operator's database or to this repository's
history.

## Who did what

| step | who | what |
|---|---|---|
| (a)(b) | dashboard-manager | scratch service on 127.0.0.1:9788, scratch repo at `da72c535` with `gamma`, `alpha`, `beta` in `src/proof.js`; `alpha` and `beta` anchored as `symbol` |
| (c) | this repo | reconfirm `alpha` AND `beta` — the first provider-supplied baselines |
| (d) | dashboard-manager | commit `2ac44b2e`: `alpha` and `beta` each start calling `gamma` |
| (e) | this repo | sweep and post |
| (f) | this repo | reconfirm `alpha` ALONE |
| page | dashboard-manager | headless Chromium on the graphs tab — their instrument, not this repo's |

## The files, in order

| file | what it shows |
|---|---|
| `c0-watch-set-before.txt` | two anchors, both `stamp: null` |
| `c1-reconfirm-both-DRY-RUN.txt` | both planned, distinct stamps, nothing sent |
| `c2-reconfirm-both.txt` | both `CONFIRMED`, `settled []` — nothing was outstanding |
| `c3-watch-set-after-baseline.txt` | read back: both stamps stored exactly as sent |
| `c4-CONTROL-sweep-before-the-edit-DRY-RUN.txt` | ⭐ same head, both `unchanged` — so a later `changed` can only be the commit |
| `d0-their-commit-verified.txt` | the commit checked before sweeping: two lines, `gamma` untouched |
| `e1-sweep-DRY-RUN.txt` | both `changed`, new stamps |
| `e2-sweep-POSTED.txt` | accepted: `marked: 2`, `recorded: 2` |
| `e3-receipts-read-back.txt` | the service's record: both `changed at 2ac44b2e`, sent as `apg-v09-proof` |
| `f1-reconfirm-alpha-alone-DRY-RUN.txt` | exactly ONE anchor planned |
| `f2-reconfirm-alpha-alone.txt` | `CONFIRMED alpha settled [code_changed]` |
| `f3-stamps-after.txt` | alpha's stamp moved to `71a955e7…` at `2ac44b2e`; beta's untouched at `73fa6cd3…` / `da72c535` |
| `f4-CONTROL-sweep-after-DRY-RUN.txt` | ⭐ alpha `unchanged`, beta `changed` — "alone", seen from the provider |

## What this proves, and what it does not

**PROVEN on the live scratch service, each step read back from the service's routes rather than from this
repo's own output:**

- a provider-supplied baseline is stored exactly as sent, and a sweep of the same code recognises it;
- a commit changing what two anchored functions call makes a sweep report both `changed`, accepted with two marks;
- reconfirming one anchor settles `code_changed` on that anchor, moves only that anchor's baseline, and leaves
  the other's baseline — and its `changed` reading — where they were.

**NOT observed here:** the marks on the page. Whether the page draws `alpha` unmarked and `beta` still marked is
dashboard-manager's instrument, and it is the half of the claim that says "clears it". Their record is in
their repository.

**The two controls are the load-bearing part.** c4 rules out the obvious wrong explanation for (e): without it,
a `changed` could have been a baseline this sweep failed to recognise, not the commit. f4 is the same check after
(f), and it is what makes "alone" a statement about baselines rather than only about the one mark the
service reported settling.

## Limits, stated

- **The code that ran was committed but unpushed.** The provider side ran from this repository's working tree
  at `328e74d2`. That commit's own tests pass (44/44 across the four touched files) and 19 mutations were watched
  red, but the FULL suite has not run at it — the last attempt was stopped by Claude Code for low memory. So
  for APG's other files this is PASSES IN TESTS, not proven.
- **The edit was chosen from the class the format sees.** The symbol stamp moves when a function's signature or
  the set of names it references changes; it does NOT move for a changed literal, operator, order or comment
  (measured over twelve edits — see `../dashboard-seam-2026-09-30/`). "Starts calling a second function" is the
  most ordinary edit in the class that moves it. A literal-only edit would have reported `unchanged`, correctly,
  and that is why the claim now says "signature or what it calls or references" rather than "edits".
- **One run, one pair of anchors, one language.** This is an existence proof that the seam works end to end,
  not a measurement of how often it catches what matters.
