# aify-dashboard x aify-project-graph: boundary proposal

2026-09-19, graph-tech-lead, for dashboard-manager and comms-tech-lead. A proposal only; no code changes.
Everything stated about apg was checked against the code at dfe1bc65 unless marked as a recommendation.

## The split in one paragraph

The dashboard owns everything people and agents author: features, tasks, decisions, informative
graphs, the links between their nodes, and the staleness state of those links. apg owns everything
derived from code: code nodes and edges, the evidence behind each answer, and the question "did the code
this anchor points at change since this stamp?". apg never stores dashboard data, and the dashboard never
parses code. The two meet at one small contract, below. apg runs on the host next to the repositories,
driven by aify-env, because the dashboard container mounts no project folders (PLAN.md, Q9).

## 1. What apg provides, and the interface

The dashboard consumes these and should never re-derive them:

| Provides | What it is today |
|---|---|
| Code nodes | File, Function, Method, Class, Module, Document, Config, Directory. Each has a path, a line range, a language and a qualified name (`extra.qname`, for example `mcp.stdio.overlay.confirmation.confirmFeature`). |
| Code edges | CALLS, IMPORTS, REFERENCES, CONTAINS, DEFINES, EXTENDS, plus doc-to-code LINKS_TO and MENTIONS. Each edge carries provenance and confidence. C++ and TypeScript edges can be verified by a language server (LSP_VERIFIED). |
| Proofs | Every answer says how far it can be trusted: `exhaustive:false` with the reason, a trust level, tree-sitter versus language-server provenance, and freshness against HEAD. A zero callers answer is a floor, not an absence. |
| Change signals | For a set of anchors and a stamp: which anchors changed or are gone since. Built and measured this week (`mcp/stdio/overlay/confirmation.js`; evidence in `docs/evidence/feature-map-pings-2026-09-18/`). |

**Proposed interface: four JSON calls.** Each call takes a project root.

- `resolve(anchors[])` returns, for each anchor, `resolved | gone | ambiguous`, with the current node
  (path, qname, kind, line range).
- `stamp(anchors[])` returns a hash per anchor: the text of the symbol, or of the file.
- `signals(anchors[], stamps)` returns `changed | gone | unchanged` per anchor, plus what cannot be
  watched and why.
- `subgraph(query)` returns nodes and edges around one anchor or file, with depth and edge-type
  filters, for drawing in Sigma. It is built on the existing verbs (callers, callees, impact,
  consequences).

A whole-project export is possible but heavy: apg's own graph is about 7,200 nodes and 34,000 edges, and
aify-comms is about 21,000 nodes and 101,000 edges. The dashboard should ask for subgraphs.

**Headless per project: not today, and cheap to add.** Today apg runs in three ways:

- an MCP stdio child per agent session (one process per session, 11 alive on this machine);
- a git-hook reindex (`scripts/reindex.mjs <repo>` runs on commit and checkout, and keeps
  `.aify-graph/graph.sqlite` fresh);
- a per-repo dashboard on 127.0.0.1 with port 0 by default, which is the "random port".

The query code is plain JavaScript modules and needs no MCP session. **Recommendation:** an aify-env
plugin calls apg as a library (or a small `apg` CLI subcommand per call) for each registered project, and
posts results to the dashboard's API. No new apg daemon and no port. aify-env already runs on each
machine, already watches the registered folders for git facts (Q9), and is the process with file access.

## 2. What moves to the dashboard or leaves apg

| Today in apg | Proposal |
|---|---|
| The feature layer: `.aify-graph/functionality.json`, its loader, lint and quality checks (about 1,200 lines in `mcp/stdio/overlay/` and `packet-overlay.js`) | Storage, editing, history and UI move to the dashboard. apg keeps only the code-facing half: resolving anchors and computing stamps and signals. |
| The confirmation state on a feature (who confirmed, when, the stamps) | Moves to the dashboard. apg computes stamps; the dashboard stores them. |
| `tasks.json` and task import from trackers | Moves to the dashboard. Tasks derive nothing from code. |
| apg's own dashboard (`mcp/stdio/dashboard/`, about 900 lines plus static files, including the 3D view) | Retire once aify-dashboard draws code graphs. |
| Feature-aware answers inside apg's verbs (packet, consequences, health, pull, brief) | Keep, reading a read-only feature export that the aify-env plugin writes. Without the dashboard, a hand-written file still works, so apg stays usable alone. |

## 3. Keeping a link valid when apg reindexes

**apg node ids are not stable, and links must not store them.** A code symbol's id is a hash of its
path and the byte span of its declaration (`mcp/stdio/ingest/identity/code-symbol-site-id.js`). Editing
the function's body keeps the id. Any edit above it, a file rename, or an extractor version bump
(which forces a full rebuild; one happened today) gives it a new id.

**Proposal: a link stores a symbolic anchor.**

    { project, path, name, qname?, parentClass?, kind }

apg resolves the anchor against the current graph on every call:

- the same name in the same file resolves, whatever its id is now;
- a file git reports as renamed is followed to its new path (proposed: the test-4 replay did this, the
  shipped confirmation check does not yet);
- more than one match (overloads, or two classes with the same method name) is `ambiguous`, with every
  candidate listed;
- no match is `gone`, with the same name found elsewhere listed as a hint, never relinked
  automatically.

The dashboard stores the anchor and the last resolved node for display, and treats the id as a cache.

## 4. How signals flow

- **apg detects; the dashboard owns the state.** apg parses code, so apg computes "changed since
  stamp". The dashboard owns the links, the stamps, whether a node is stale, who acknowledged it, and the
  history.
- **Trigger:** on each new commit in a registered project (aify-env's watcher sees HEAD move), the aify-env
  plugin asks the dashboard for that project's linked anchors and stamps. It calls
  `apg signals(...)` and posts the result. The dashboard marks linked nodes stale.
- **So it is pull by the plugin, push to the dashboard.** apg never calls the dashboard and needs no
  knowledge of it.
- **Re-confirming:** a person or agent checks the node's description against the code, and the dashboard
  asks for a fresh `stamp(...)`. That clears it.
- **Committed code only, by default.** Uncommitted edits would ping on every save.
- **What to expect, measured:** on aify-comms at about 280 commits a week, symbol-level signals caught 8
  of 9 features that really went stale, and flagged about a third of features each week. A quieter
  repository flags less. A signal says the code changed, not that the description is wrong.

## 5. What makes this hard, plainly

1. **No stable node ids** (section 3). Every consumer must go through anchor resolution.
2. **No headless service today.** apg is an MCP child per session. Long-lived children also serve stale
   code after an update until restarted, and 11 of them are alive now. Driving apg from aify-env as a
   library call per event avoids both problems.
3. **The dashboard container cannot read repositories.** apg must run on the host; the aify-env plugin is
   the bridge.
4. **Rebuilds cost real time.** A full index takes about 35 seconds for apg and 60 to 95 seconds for
   aify-comms. Commits are indexed incrementally, but an extractor upgrade forces one full rebuild per
   repository.
5. **The answers are floors.** Callers come from tree-sitter heuristics, and only C++ and TypeScript can
   be verified by a language server. The dashboard should show apg's trust fields, not a bare count.
6. **Only literal anchors are watched.** A glob file anchor, or a change in code the anchors do not name,
   produces no signal. How well a node is watched depends on how its anchors are chosen.
7. **Adoption evidence is weak.** In a baseline check (2026-09-14) an agent with apg never called it.
   On "where is the code that does X", apg answered 0 of 12 where a body-text index answered 12 of 12
   (2026-09-10). The dashboard should not count on apg for discovery. apg is strong on typed, bounded,
   evidence-carrying answers about code it has indexed.

## Questions for the operator, with recommended defaults

| Question | Recommended default |
|---|---|
| Where does the truth for features live: the dashboard database, or a file in the repository? | The dashboard database, with a read-only export into the repository for offline agents and apg's verbs. The repository file became tracked in git this week; that would turn into the export. |
| Does apg run only as a library called by the aify-env plugin, or also as a standing service? | Library and CLI only. Add a service later if a use needs it. |
| Retire apg's own dashboard and 3D view once aify-dashboard draws code graphs? | Yes. |
| Should signals fire on commits only, or on uncommitted edits too? | Commits only. |
