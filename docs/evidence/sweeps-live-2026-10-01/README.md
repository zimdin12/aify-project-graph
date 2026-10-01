# Sweeps, live: the provider's first swept posts against the dashboard's real sweep route

**The contract:** aify-dashboard `ec55995` (schema 43), DESIGN-QUIET-ANCHORS step 3. A provider reserves a sweep
before measuring, measures the set the reservation returns, and posts with `sweep: {id, predecessor}`. The service
orders one reporter's reports by a cursor. Their side: 28 of 28 mutations red, PASSES IN TESTS. No provider had
posted a sweep for real. `run.mjs` is the first, on a scratch service, through the provider's real entry points
(`post-watch-signals.mjs`, `reconfirm-anchor.mjs`) and its client.

## Result (`output.txt`): every pre-registered check held

| check | what happened |
|---|---|
| D | `--dry-run` reserved nothing: the first real reservation afterwards was #1 with no predecessor |
| P1 | a real CLI sweep: `APPLIED`, exit 0 |
| P2 | the same payload twice under one id: `APPLIED`, then `REPEAT`, both exit 0 |
| P3 | #3 reserved, #4 applied by the CLI, then #3 posted: 409 `stale_sweep`, exit 3 |
| P4 | #5 reserved, a real change committed and reconfirmed, then #5 posted: 409 `stale_baseline`, exit 2, flagged re-read |
| P7 | an unswept post after adoption: 409 `sweeps_adopted`, exit 2, not flagged re-read |
| A-B-A | three CLI sweeps at one head (clean, then the anchored file deleted with `--allow-dirty`, then restored): `unchanged`, `gone`, `unchanged`, all `APPLIED`, each naming the previous applied sweep (#6, #7 after #6, #8 after #7) |

P4's refusal recorded nothing and did not spend a place in the order: the next sweep was #6 after #4.

## Run 1 failed one check, and the check was wrong (`output-run1.txt`)

Run 1's P4 reconfirmed UNCHANGED code at the same commit. The baseline it wrote was identical, the reservation's
baseline digest did not move, and the post was `APPLIED`, so P4 failed. A reconfirm that changes no baseline leaves
the sweep's measurement valid, so that is the scenario's error, not the service's. P4 was changed to reconfirm a
real change, which is what the claim is about, and the header of `run.mjs` says so. The change is recorded rather
than hidden because it was made after seeing a result.

## Two things found that the unit tests could not see

1. **Every refusal this provider ever printed said "no message".** The service's refusal body is
   `{ ...details, error: <text>, code }` (their `http/server.ts`). The client read `body.message`, which the service
   never sends. The unit test passed because its fake body used a `message` field the real one does not have. For
   `stale_sweep` that text is the only place the current cursor is named. Fixed in the same commit as this
   evidence's code, with a test against the real shape.
2. **Every 409 was flagged "re-read"**, including `inconsistent_retry` and `unknown_sweep`, where re-reading and
   posting again would loop. The flag is now decided by code.

## Observations for the dashboard (recorded, not predicted)

- **O1.** A reconfirm that writes an identical baseline does not make an outstanding reservation stale (run 1).
- **O2.** After A-B-A, the `code_gone` mark raised by B is still there after A' reports `unchanged`. That fits
  "`unchanged` settles nothing". It does not obviously fit the design text "code_gone from B has its episode ended
  by A'". The two need reconciling on their side.

## Guards

- **The server is `ec55995` by construction.** Their working tree had uncommitted edits in `server/` at the time,
  so it was not used. `git archive` exported the committed tree read-only into a scratch directory.
- **Their packages through a junction, removed safely.** On cleanup the junction is removed first with `rmdir`, and
  their `node_modules` is checked to still exist before anything is deleted recursively. Both runs ended with
  "their node_modules still present: true".
- **Scratch on both sides.** Port 9792, checked free, with the live service on 9700 answering the same probe as its
  positive control. A scratch database, a throwaway key that is never printed, a new git repository.

## Limits

- P2, P3, P4 and P7 post through the provider's client from the harness, not through the CLI process. The CLI
  cannot be paused between reserving and posting. Those steps exercise the same client and the same
  `outcomeOfPost` the CLI uses, on the real service. D, P1 and A-B-A are the CLI end to end.
- One anchor, one language, one reporter. Two reporters advancing independently was not exercised here.
