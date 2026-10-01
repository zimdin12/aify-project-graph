# The provider request queue, served for real for the first time

**What it is:** the dashboard queues a call (`POST /api/v1/provider/requests`). A host claims it, answers it, and
posts the result. The service half (aify-dashboard `36b6217`: calls `resolve`, `stamp`, `subgraph`) PASSES IN
TESTS. Nothing had ever claimed a queued call. `run.mjs` queues real calls on a scratch service built from that
commit and serves them with `scripts/serve-provider-requests.mjs`, the provider's one-shot server.

## Result (`output.txt`): every pre-registered check held, on the first run

| check | what happened |
|---|---|
| Q1 | four calls queued (201 each); a queued `signals` refused with 400 `unknown_call`, as 36b6217 intends |
| Q2 | one server run claimed 4 and stored 4, exit 0 |
| Q3 | read from the service's own database: every ok answer carries provenance at the commit read, `exhaustive: false`; `subgraph` is stored as a failure with "subgraph is not supported by this provider yet"; an empty `anchors` list is stored as a failure |
| Q4 | `stamp`: alpha stamped at the commit, the ambiguous `run` and a missing file refused by code. `resolve`: `found`, `ambiguous` with both candidates (`src.a.First.run`, `src.a.Second.run`), `gone`, `unwatched` |
| Q5 | with alpha edited and `b.js` deleted in the working tree but not committed: alpha's stamp **equals** the clean one, and `b.js` resolves `found` |
| Q6 | CONTROL for Q5: once the edit is committed, alpha's stamp **differs**, so the instrument can see a change |
| Q7 | an empty queue: claimed 0, exit 0 |

Q3 and Q4 are read from the scratch service's database after it stopped: what the service **stored**, not what
the server script printed. At 36b6217 no JSON route reads a stored answer back.

## What this needed on the provider side

- **Reading the commit.** `makeInstruments(repo, { at })` reads contents with `git cat-file blob <commit>:<path>`.
  Presence is a `blob` at that path, exact in case, and a directory does not count. Q5 and Q6 are this property,
  live.
- **Ambiguity.** The resolver used to stamp the first of two same-named symbols. It now refuses with
  `ambiguous_anchor` and returns the candidates beside the row. That applies to sweeps too, so an ambiguous anchor
  now reads `unwatched: ambiguous_anchor` there instead of being silently tracked as one of the two.
- **A note for whoever writes the fix hint:** candidate qualified names are module-qualified
  (`src.a.First.run`). An anchor named by that exact string resolves; `First.run` alone does not.

## Guards

- The server is `36b6217` by construction (`git archive`), never the dashboard's working tree.
- Their `node_modules` is reached through a junction. On cleanup the junction is removed first, and their packages
  are checked to still exist before the scratch area is deleted. The run ended with them present.
- Port 9793, checked free, with the live service on 9700 answering the same probe as its positive control.

## Limits

- Lease expiry was not exercised: every answer was posted within seconds of its claim.
- One repository, one language, and one host key.
- `subgraph` is refused, by agreement, until apg has a read-only mode.
