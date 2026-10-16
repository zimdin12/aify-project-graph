# subgraph through the live queue (2026-10-17)

The first `subgraph` answered through the dashboard's request queue. APG was at 3c8a08d2, pushed as aa30ad11 with a
green suite at fee47e9d.

**Request.** Queued by dashboard-manager on the live service (http://127.0.0.1:9700), requestId
`01M53GQMMJMWCSA1MSAYVMEZ7G`, project `01M4SFC4NEAH870JM50Y8KB1VH` (aify-dashboard):

    { call: "subgraph", args: { anchor: { project: "aify-dashboard", kind: "symbol",
      path: "server/src/graphs/query.ts", name: "runQuery" }, depth: 1, limit: 200 } }

**Claim and post.** Run by hand from the aify-dashboard checkout (HEAD e6cf142), because aify-env's tick does not
cover that repository yet:

    cd C:/Docker/aify-dashboard
    APG_DASHBOARD_URL=http://127.0.0.1:9700 APG_DASHBOARD_ENV=C:/Docker/aify-dashboard/.env \
    APG_DASHBOARD_PROJECT=01M4SFC4NEAH870JM50Y8KB1VH node C:/Docker/aify-project-graph/scripts/serve-provider-requests.mjs

Exit 0, `claimed 1`, `STORED 01M53GQMMJMWCSA1MSAYVMEZ7G subgraph ok`. The key does not appear in the output (grep: 0).

**Read back from the service.** `GET /api/v1/provider/requests/01M53GQMMJMWCSA1MSAYVMEZ7G` returned HTTP 200 and
25,081 bytes, with keys `requestId, projectId, answer`. The answer:

| field | value |
|---|---|
| indexCommit / head | 93c8c65b / e6cf1421 |
| stale, staleBecause | true, `index_behind_head` (the index was left stale on purpose) |
| matched | 32 nodes, 96 edges, 9 External dropped; truncated false |
| returned | 32 nodes, 96 edges |
| resolution | name 82, structural 14; compiler 0, ambiguous 0 |
| provenance | providerCommit e6cf1421, exhaustive false |

The direct read of the same index before the queue run gave the same 32 / 96 / 9, so nothing changed in transit.
Zero ambiguous edges is expected here: every ambiguous edge in this index points at an External node, and those
are left out by default.

**Not proven here:** that the dashboard page draws this answer. That half is dashboard-manager's and was not
deployed at the time of this run.
