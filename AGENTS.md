# Agent install guide — aify-project-graph

**You are an agent reading this to install aify-project-graph into your host runtime.** Follow the steps below in order. Every step is deterministic; do not skip or reorder.

## What this is

A local MCP server that indexes the user's current repo into a SQLite-backed code graph and exposes high-intent query verbs (`graph_report`, `graph_whereis`, `graph_callers`, `graph_impact`, etc.). Compact NODE/EDGE output with `file:line` citations. No server, no container, client-side only.

## Before you start

Check the user's runtime. This guide covers:

- **Claude Code** — MCP servers stored under `mcpServers` in `~/.claude.json` (use `claude mcp add` CLI, do not hand-edit; note: not `~/.claude/settings.json` which is the hooks/permissions file). Skills at `~/.claude/skills/`.
- **Codex** — MCP servers registered via `codex mcp add` CLI (writes `~/.codex/mcp.json`).
- **OpenCode** — MCP servers under `mcp` in `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json`.

If unsure, ask the user which they're in.

## Install (all runtimes)

The install is driven by one of three runtime-specific agent-executable docs. Read the one matching the user's runtime and follow every step:

- **Claude Code (native Windows / macOS / Linux)** → [`install.claude.md`](install.claude.md)
- **Codex (WSL or native Linux)** → [`install.codex.md`](install.codex.md)
- **OpenCode** → [`install.opencode.md`](install.opencode.md)

Each doc pins the clone to a runtime-specific path so two runtimes on the same machine (e.g. Claude Code on Windows + Codex in WSL) don't collide on one `better-sqlite3` native binary:

| Runtime | Pinned clone path | MCP registration method |
|---|---|---|
| Claude Code | `~/.claude/plugins/aify-project-graph` | `claude mcp add --scope user` (writes `~/.claude.json`) |
| Codex | `~/.codex/plugins/aify-project-graph` | `codex mcp add` |
| OpenCode | `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/aify-project-graph` | JSON-patch `opencode.json` |

**Profile:** Claude Code uses the full toolset (17 visible verbs). Codex and OpenCode use `--toolset=lean` (3 visible: `graph_impact`, `graph_path`, `graph_change_plan`; the other 14 remain callable by name via `tools/call`).

**Platform gotcha:** `better-sqlite3` is native — the compiled binary has to match the runtime. If the same clone is shared across Windows and WSL, load fails with `not a valid Win32 application` or equivalent. The pinned paths above already separate the clones; if you still see this error, run `npm rebuild better-sqlite3` in the runtime you plan to use.

**Skills** (Claude Code only) — the install doc copies the whole `integrations/claude-code/skill{,s}/` tree with a directory loop, so new skills are picked up without updating these docs. Codex and OpenCode don't load skill files; MCP tool descriptions are self-documenting there.

**Verify** — on first session after restart: `graph_status()` should return `indexed: false` then any query verb triggers an auto-build. If the tool is not found, the MCP didn't register (rerun the relevant install-doc step).

## Day-1 setup: build the functionality overlay

**This step is not optional if you want the planning briefs to do work.** The empty-overlay case was measured (2026-04-19 deep bench): `brief.plan.md` shrinks to ~70 tokens of headers with no action-bearing content, and brief-only loses tokens vs live MCP on plan tasks. With a populated `.aify-graph/functionality.json`, plan briefs gain `open:/tests:/load:` per feature and brief-only wins plan tasks −19% tokens / −28% duration.

On Claude Code:
```
/graph-build-functionality
```
The skill reads the graph, drafts a `functionality.json` with feature anchors, and shows a diff for the user to accept. Takes 1-2 minutes and one user review pass.

On Codex/OpenCode (no skill support):
```bash
cp <target-path>/docs/examples/functionality.sample.json <target-repo>/.aify-graph/functionality.json
# hand-edit to match the user's feature mental model
node <target-path>/scripts/graph-brief.mjs <target-repo>   # regenerate briefs
```

Check the result: `brief.plan.md` should now have a FEATURES section with `open:` / `tests:` / `load:` lines per feature. If it's thin (~70 tokens), the overlay is empty and the above step was skipped or failed.

## Using it afterwards

Key verbs — invoke on demand, not all at session start:

```
graph_report()                               # orient
graph_preflight(symbol="get_db")             # SAFE/REVIEW/CONFIRM before editing
graph_path(symbol="handleRequest")           # execution trace
graph_impact(symbol="User")                  # blast radius
graph_file(path="src/auth/token.ts")         # whole-file digest
```

Verb notes by profile:

- **Claude Code / full toolset**: `graph_search(query="dispatch")`, `graph_whereis(symbol="get_db", expand=true)`, `graph_callers(symbol="get_db")`
- **Codex / OpenCode lean toolset**: `graph_lookup(symbol="get_db")` for exact names. Low-level search/caller verbs are intentionally omitted from lean mode; remove `--toolset=lean` if you want the full surface.

The graph lives in `<target-repo>/.aify-graph/graph.sqlite`. Add `.aify-graph/` to the target repo's `.gitignore` if not already present — the graph is derived and should never be committed.

## Static briefs (prefer over MCP for orient-shaped tasks)

`.aify-graph/` also contains five precomputed brief artifacts that often answer orient/plan questions without a single MCP call:

- **`brief.md`** (~700-900 tok) — human-readable full brief
- **`brief.agent.md`** (~300-700 tok; apg-like MCP servers with 19 verbs reach 700, smaller repos hit 300) — dense prompt substrate; paste into session prompt for orient sessions
- **`brief.onboard.md`** (~250-500 tok) — stripped variant for new-to-this-repo sessions
- **`brief.plan.md`** (~300-600 tok when functionality.json populated, ~70 tok when empty) — leads with features, open tasks by feature, feature-tagged recent commits, and risk areas. For change-planning sessions.
- **`brief.json`** — machine-readable equivalent

Measured (2026-04-20 cross-tester, matched-N): brief-only beats no-graph baseline by **−19% to −34% tokens and 1.5-2.9× wall-clock** on Claude Code Agent + Opus for orient/search on small-to-medium repos. On Codex + gpt-5.4 the same shell-accessible shapes are roughly parity aggregate (+3.6% tok / +11.3% dur matched). Quality GAINS show up on overlay-dependent task shapes (pre-delete impact, feature drilldown, trust assessment, recent-in-feature) when `functionality.json` is populated: Phase 2 APG bench measured baseline 2/4 clean → brief-only 4/4 clean. Full cross-tester matrix + Phase 2 addendum at [docs/dogfood/ab-results-2026-04-20-cross-tester.md](docs/dogfood/ab-results-2026-04-20-cross-tester.md).

Regenerate with:
```bash
node <target-repo>/scripts/graph-brief.mjs <target-repo>
```

## Functionality + task overlays (Claude Code)

For richer briefs, use the skills to build overlays:

1. `/graph-build-functionality` — agent proposes `.aify-graph/functionality.json` from repo structure; user reviews diff
2. `/graph-build-tasks` — agent pulls open tasks from whatever tracker is connected (ClickUp/Asana/Linear/Jira/GitHub) and attributes them to features
3. `/graph-anchor-drift` — run after commits that touched anchored code; proposes targeted anchor patches

After running any of these, regenerate briefs: the `FEATURES` / `OPEN_TASKS` / `TRUST` sections in brief.plan.md automatically pick up the new data.

## Working with teammate agents

If you're operating alongside other agents (e.g. via aify-comms or an equivalent message channel), you have teammates, not a pool of reviewers to summon at end. **Two brains beats one.** Default discipline:

- **Share design decisions before implementing**, not after. If a teammate already weighed in on shape, invite them into the next fork — don't ship a solo implementation and then ask for review.
- **Split real work**, not just review passes. Architecture specs, implementation, testing, dogfooding — distribute these. If one agent commits 20 times in a row while the other only reviews, the split is broken.
- **Name the gap when delegating**: "please own spec X" is actionable; "thoughts?" is not.
- **Push back is a feature, not friction**. If a teammate disagrees, that's often the session's highest-value moment. Don't smooth it over — lean in and converge.
- **Acknowledge authorship honestly in commits.** If a teammate wrote a spec or caught a bug, credit them (`dev-authored`, `caught by dev review`, `dev-approved`) so the git history tells the true story.
- **If a teammate can't commit from their sandbox**, you commit their work and say so. Don't let sandbox constraints reduce them to advisor-only.
- **Rotate the "hands on keyboard" role.** If one agent has been typing for an hour, stop and ask the other to drive the next chunk.

Anti-patterns to avoid:
- Solo stretches of 5+ commits without a teammate review loop.
- "I'll send this for review later" — later usually doesn't happen.
- Using the teammate as a rubber stamp rather than a real second opinion.
- Framing teammate pushback as an obstacle rather than a signal.

The user is watching the split and will call it out. Save them the trouble — self-audit your own cadence and pass the baton before they have to tell you.

## What the install is NOT

- No server to run — the MCP process launches on-demand via stdio
- No Docker, no cloud service, no account setup
- No daemon — the graph builds in-process on first query per session

## If something goes wrong

- `graph_status()` returns `indexed: false` after multiple queries → check Node version (`node --version` must be ≥20)
- `unresolvedEdges` is very large → `graph_index(force=true)` for a clean rebuild
- Suspicious stale data → `rm -rf <target-repo>/.aify-graph` and query again to force rebuild
- Same repo used from both Windows and WSL → native Node addons can flip platforms (`better-sqlite3` is the usual one). Re-run `npm rebuild better-sqlite3` in the runtime you plan to use.
- Skill-specific behaviour questions → read `integrations/claude-code/skill/SKILL.md`
