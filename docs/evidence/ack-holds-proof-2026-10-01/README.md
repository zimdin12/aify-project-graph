# An acknowledgement holds across commits, and re-opens on a different change

**The claim (the dashboard's, at `28001b3`, schema 39):** a code mark's condition is the provider's candidate
stamp, so a `changed` finding that an operator acknowledged stays acknowledged at later commits that change
nothing the stamp models, and re-opens when the change itself changes. Their tests pass. `run.mjs` is the check
from the provider's side, on the provider's real entry points (`reconfirm-anchor.mjs`, `post-watch-signals.mjs`)
against their real server.

## Pre-registered, then run (`output.txt`)

The predictions are in `run.mjs`'s header, written before the first run. All eleven checks held.

| step | commit | candidate | mark afterwards |
|---|---|---|---|
| baseline | C1: alpha calls nothing | — | — |
| 2 | C2: alpha starts calling `gamma` | `71a955e7…` | open, version 1 |
| 3 | acknowledge (agent key, version 1) | — | acknowledged |
| A1 | C3: README only | `71a955e7…` same | **still acknowledged**, version 1, `lastReportedAt` moved |
| A2 | C4: an unrelated function added to the same file | `71a955e7…` same | **still acknowledged**, version 1, `lastReportedAt` moved |
| B | C5: alpha calls `beta` instead | `186d30bc…` different | **re-opened**, version 2 |

**The controls:**
- **B makes A mean something.** A mark that never re-opened would pass A1 and A2.
- **`lastReportedAt` makes "still acknowledged" mean something.** A sweep that never reached the mark would also
  have left it acknowledged.
- A2 is stronger than the dashboard's own proposed check (a commit with nothing edited): the anchored file
  itself changed, and the finding did not.

## Guards

- **The server code was `28001b3` and nothing else.** `run.mjs` refuses unless the dashboard's `server/` is clean
  and identical to `28001b3`, checked before the service started and after it stopped. Both passed (checkout HEAD
  `28001b3`).
- **Scratch on both sides.** Port `9790`, checked free, with the live service on `9700` answering the same probe
  as its positive control. A scratch database, a throwaway key that is never printed, a new git repository. The
  scratch area is deleted at the end.
- **The provider ran from this repository at `45bdc565`** (committed, unpushed). The full suite has not run at
  that commit: the last attempt was stopped by Claude Code for low memory.

## Limits, stated

- **This proves the outcome, not which field decided it.** Between A2 and B, my `changed` text also moved (it
  names the candidate since `45bdc565`). The dashboard says its condition for `changed` does not read the text.
  I have not read that code; the outcome here is the same either way.
- **The acknowledgement was made with an agent key, not an operator session.** The route accepts either.
- One anchor, one language, one run. `restamp`, `gone` and `unwatched` conditions were not exercised.
