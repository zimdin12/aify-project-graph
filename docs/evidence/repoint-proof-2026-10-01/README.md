# Re-pointed anchor — the dashboard's fix, verified from the provider side

**Defect (found here, 2026-10-01):** editing an anchor to name a different function — same kind, same file, no
code change — made a sweep report `changed`, which put "the code behind this changed" on the dashboard page. A
stamp did not record what it was a stamp *of*, and a watchId survives document revisions, so the old target's
stamp was compared with the new target.

**Fix (the dashboard's, at `ed1f440`, schema 38):** a baseline records the whole anchor as canonical JSON; the watch
set sends a stamp only with the anchor it was taken of, and `stamp: null` otherwise. Their evidence: 8 of 8 named
mutations red. That is PASSES IN TESTS. `run.mjs` is the check from the other side of the seam, on the provider's
real entry points (`reconfirm-anchor.mjs`, `post-watch-signals.mjs`) against their real server.

## Result (`output.txt`)

| step | stamp handed to the provider | provider's verdict |
|---|---|---|
| 1. reconfirm the node while it names `alpha` | `784aec1d…` | — |
| 2. CONTROL: nothing edited | `784aec1d…` | `unchanged` |
| 3. CONTROL: an unrelated field (the label) edited | `784aec1d…` — **survives** | `unchanged` |
| 4. the same node re-pointed at `beta`, no code change | **`null`** | **`restamp`** |
| 5. that sweep posted | — | accepted; one mark, reason **`unconfirmed`**, not `code_changed` |

Step 3 is the control that makes step 4 mean something: a fix that dropped the baseline on *every* edit would also
pass step 4. The stamp surviving an unrelated edit and vanishing on a re-point is the fix discriminating.

## Guards

- **The server code was the fix and nothing else.** Their server runs from their working tree, which is shared and
  has had mutation testing editing it. `run.mjs` refuses unless `server/` is clean *and* unchanged between
  `ed1f440` and HEAD. Checked immediately before the service started and again after it stopped; both passed
  (checkout HEAD `9e5ef72`, which differs from `ed1f440` only outside `server/`).
- **Scratch on both sides.** Its own directory and port (`9789`) — not the v0.9 run's, whose setup deletes its
  directory. A scratch database, a throwaway key that is never printed, a new git repo. Port 9789 was checked free
  first, with the live service on 9700 answering the same probe as a positive control. The scratch area is deleted
  at the end.

## Limits, stated

- **The scratch service's `/health` reported `gitSha: null`** — it runs from source, not a stamped build. The git
  guard above, not `/health`, is what identifies the code that ran.
- **`cause: "first-baseline"` was not observed live.** It is what the resolver emits for a null stamp (unit-tested
  in `tests/unit/scripts/anchor-resolver-causes.test.js`), and it was posted, but the dashboard does not read that
  field yet. What was observed live is the status (`restamp`) and the mark it produced (`unconfirmed`).
- **The pre-fix behaviour was not re-run on a live service.** The "before" is the resolver-level measurement that
  found the defect. Within this run, the discriminating observation is the stamp itself: `null` after the
  re-point, and still present after the unrelated edit.
- One node, one re-point, one language.
