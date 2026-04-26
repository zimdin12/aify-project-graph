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

**Profile:** Claude Code uses the full callable surface, with a few legacy orient aliases hidden from `tools/list`; Codex and OpenCode use `--toolset=lean` (5 visible: `graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`; the other verbs remain callable by name via `tools/call`).

**Platform gotcha (mostly auto-handled):** `better-sqlite3` is a native module. If the same clone is shared across Windows and WSL, its compiled binary flips platforms. The MCP server's **native-module preflight self-heals this on startup**: it probes the binary, and if it sees `not a valid Win32 application` / `invalid ELF header` / `ERR_DLOPEN_FAILED`, it runs `npm rebuild better-sqlite3` once automatically before accepting any tool calls. You only need to intervene if the auto-rebuild itself fails (missing compiler toolchain); in that case run `npm rebuild better-sqlite3` manually in the runtime you plan to use.

**Skills** — the install doc copies the whole `integrations/<runtime>/skill{,s}/` tree with a directory loop, so new skills are picked up without updating these docs. **Both Claude Code and Codex support skills natively**: Claude Code loads from `~/.claude/skills/`, Codex from `~/.codex/skills/` (see `install.codex.md` Step 3). OpenCode doesn't load skill files today; MCP tool descriptions are self-documenting there.

**Verify** — on first session after restart: `graph_status()` should return `indexed: false` then any query verb triggers an auto-build. If the tool is not found, the MCP didn't register (rerun the relevant install-doc step).

## Day-1 setup: build the functionality overlay

**This step is not optional if you want the planning briefs to do work.** The empty-overlay case was measured (2026-04-19 deep bench): `brief.plan.md` shrinks to ~70 tokens of headers with no action-bearing content, and brief-only loses tokens vs live MCP on plan tasks. With a populated `.aify-graph/functionality.json`, plan briefs gain `open:/tests:/load:` per feature and brief-only wins plan tasks −19% tokens / −28% duration.

Before the first index in a repo, do the hygiene check that `/graph-build-all`
does: add `.aify-graph/` to `.gitignore`, and add repo-local scratch/build
patterns to `.aifyignore` before graph generation if needed. Examples:
`build-linux-techlead`, `generated/**`, `*.tmp.cpp`. This prevents local
artifacts from entering the initial graph.

On Claude Code:
```
/graph-build-all
```
The skill checks ignore hygiene, builds the graph, drafts a `functionality.json`
with feature anchors, and shows a diff for the user to accept. Takes 1-2
minutes and one user review pass.

On Codex:
Use the shipped `graph-build-all` skill for first setup. Codex loads it from `~/.codex/skills/` after install; it is not a slash command, but the agent should follow it when the user asks to generate project graphs. Use `graph-build-functionality` later for overlay-only refreshes.

On OpenCode (no skills), or if you want the manual fallback:
```bash
cp <target-path>/docs/examples/functionality.sample.json <target-repo>/.aify-graph/functionality.json
# hand-edit to match the user's feature mental model
# add feature-level `tests` arrays on repos with monolithic/shared test files
node <target-path>/scripts/graph-brief.mjs <target-repo>   # regenerate briefs
```

Check the result: `brief.plan.md` should now have a FEATURES section with `open:` / `tests:` / `load:` lines per feature. If it's thin (~70 tokens), the overlay is empty and the above step was skipped or failed.

## Using it afterwards

Key verbs — invoke on demand, not all at session start:

```
graph_report()                               # live orient fallback; prefer brief.agent.md first
graph_preflight(symbol="get_db")             # SAFE/REVIEW/CONFIRM before editing
graph_path(symbol="handleRequest")           # execution trace
graph_impact(symbol="User")                  # blast radius
graph_file(path="src/auth/token.ts")         # whole-file digest
```

Verb notes by profile:

- **Claude Code / full toolset**: `graph_search(query="dispatch")`, `graph_whereis(symbol="get_db", expand=true)`, `graph_callers(symbol="get_db")`
- **Codex / OpenCode lean toolset**: `graph_packet(target="feature:auth")` (one-shot orientation, cheap+coarse), `graph_consequences(target="get_db")`, `graph_pull(node="get_db")`, `graph_change_plan(symbol="get_db")`, `graph_health()` are the listed surfaces. Reach for packet first for orientation; escalate to consequences/change_plan when packet's coarse view loses precision. Low-level search/caller verbs are intentionally omitted from lean mode; remove `--toolset=lean` if you want the broader full surface.

The graph lives in `<target-repo>/.aify-graph/graph.sqlite`. Add `.aify-graph/` to the target repo's `.gitignore` if not already present — the graph is derived and should never be committed. This is separate from `.aifyignore` / `.aifyinclude`, which control what the graph indexes, not what git tracks. `.aifyignore` accepts bare directory names plus path/glob patterns such as `generated/**` and `*.tmp.cpp`.

## Team trust posture

Treat the graph as a map, not as a verdict.

- If `graph_health()` says the graph is stale, run `graph_index(force=true)` before using live graph results for planning or review.
- If `TRUST` is `weak`, use graph output as a starting point for source reads. Do not approve a patch, delete code, or claim "nothing else uses this" based only on graph output.
- On C++ / template-heavy / macro-heavy repos, expect false negatives in caller/callee and impact results. Pair graph queries with `rg` / file reads.
- Good team pattern: ask the graph for likely callers, owners, features, tasks, and affected files; then verify the actual code and diffs before deciding.

## Static briefs (prefer over MCP for orient-shaped tasks)

`.aify-graph/` also contains five precomputed brief artifacts that often answer orient/plan questions without a single MCP call:

- **`brief.md`** (~700-900 tok) — human-readable full brief
- **`brief.agent.md`** (~300-1100 tok; includes **PATHS** pre-computed execution chains for top EXPORTS — apg with 21 MCP verbs + PATHS ≈ 1000 tok, small repos without explicit exports ≈ 300 tok) — dense prompt substrate; paste into session prompt for orient + trace sessions
- **`brief.onboard.md`** (~250-500 tok) — stripped variant for new-to-this-repo sessions (drops PATHS, recent, risks)
- **`brief.plan.md`** (~300-600 tok when functionality.json populated, ~70 tok when empty) — leads with features, open tasks by feature, feature-tagged recent commits, and risk areas. For change-planning sessions.
- **`brief.json`** — machine-readable equivalent

**Honest measurement.** Briefs + overlay reliably save ~15-20% wall-clock and tool calls vs Grep-only on planning shapes (consistent across apg dogfood + 2026-04-26 echoes A/B). Live verbs are conditionally helpful — used surgically (≤3 per planning task) they add precision; over-called they tip net negative because each `graph_find`/`graph_consequences`/`graph_file` returns hundreds-to-thousands of context tokens. Skill prose now hard-caps at 3 live calls per planning task. Earlier `−23.1% / 6-2` headline from apg postfix4 was partly inflated by silent live-verb failures pre-cwd-fix (commit `394c1a0`); single-run results don't justify a confident headline either way (n≥3 per arm needed). Artifacts: [postfix4](docs/dogfood/token-cost-bench-2026-04-25-postfix4.json), [final](docs/dogfood/token-cost-bench-2026-04-26-final.json). Plan history: [2026-04-25 upgrade](docs/superpowers/plans/2026-04-25-upgrade-plan.md). Older 2026-04-20 cross-runtime: Claude Code Agent + Opus saw **−19% to −34% tokens and 1.5-2.9× wall-clock**, Codex + gpt-5.4 roughly parity.

Regenerate with:
```bash
node <target-path>/scripts/graph-brief.mjs <target-repo>
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

## Multi-repo: one MCP server works on one repo at a time

The registered MCP server binds to ONE `repoRoot` — the directory where the runtime (Claude Code / Codex / OpenCode) was launched. Live verbs (`graph_impact`, `graph_path`, `graph_change_plan`, …) query that graph only. Calling a live verb while working in a different repo returns `NO MATCH`.

- **Cross-repo path that works:** read static briefs (`.aify-graph/brief.agent.md` etc.) in the target repo directly. Agents do this in the benchmarked "brief-first" workflow and it's the dominant win (measured −36% tool calls on orient tasks).
- **For live verbs in a different repo:** launch the runtime FROM that repo so the MCP server's cwd matches. The skills and registration are the same.

No multi-root MCP registration exists today. If your team regularly needs live verbs across multiple repos, the current options are per-repo launches or leaning on static briefs. A future `graph_export` verb could also unblock cross-tool / cross-repo consumers.

## Multi-agent teams sharing one repo

This is the "4 agents work in the same folder" case. It's supported — here's how it behaves, what's safe, and what to watch for.

**What's safe out of the box:**

- **Concurrent reads across agents.** SQLite (WAL mode) lets every agent call read-only verbs (`graph_report`, `graph_path`, `graph_pull`, etc.) simultaneously. No coordination needed.
- **Concurrent writes are serialized.** Every call that could mutate the graph (`graph_index`, any verb whose `ensureFresh` decides to rebuild) goes through a two-tier lock:
  - An in-process queue (FIFO) stops multiple verbs *within one agent's MCP server* from racing each other.
  - `.aify-graph/.write.lock` (proper-lockfile) serializes across agent processes. The retry budget is ~3 minutes of polite backoff, which covers a peer doing a first-time full index on most repos.
- **Stale cache never lies.** Each agent's MCP server has a 5-second freshness cache — that's per-process. If agent A reindexes, agent B sees the new state on its next verb call (at worst 5 seconds later).
- **Overlays (`functionality.json`, `tasks.json`) are plain files.** Standard git workflow applies: whoever edits last wins. Use `/graph-feature-edit` + `/graph-task-edit` for surgical single-edits so diffs stay small and mergeable.

**What to watch for:**

- **First-time index on a huge repo.** If 4 agents all hit an un-indexed repo simultaneously, one wins the lock and builds; the others wait up to ~3 minutes. On very large repos (10-minute first-index), the losers may time out. Mitigation: have one agent run `graph_index()` explicitly before fanning out the team.
- **Uncoordinated `graph_index(force=true)`.** Any agent can force a full rebuild. If two agents both decide to force-rebuild, they serialize and do the work twice in sequence. Agree on one index owner for force-rebuilds.
- **Dashboard port conflicts.** `graph_dashboard` picks the first free port; each agent that opens one claims its own. Not a concurrency bug but it means four browser tabs if four agents launch it.
- **Dirty-tree skew across agents.** Each agent's `graph_status` uses their *own* working-tree git state for `dirtyFiles`. If agent A has uncommitted changes, agent B won't see them — they see their own tree. That's correct, but it means "dirty" is per-agent, not shared.

**Team hygiene (applies in addition to the etiquette above):**

- **One agent owns the overlay lifecycle.** `/graph-build-functionality` and `/graph-build-tasks` produce JSON diffs the user reviews. Running these from multiple agents at once creates merge thrash. Designate one agent (usually the tech-lead role) to own overlay updates; others consume them.
- **Split by feature, not by verb.** Two agents calling `graph_impact` on different symbols is fine. Two agents calling `graph_index(force=true)` at the same time is wasted work.
- **If you see a staleness warning in your `_warnings` envelope**, a teammate likely just landed commits. Prefer re-reading the brief over forcing a reindex yourself — the next verb call will refresh via ensureFresh if needed.

## What the install is NOT

- No server to run — the MCP process launches on-demand via stdio
- No Docker, no cloud service, no account setup
- No daemon — the graph builds in-process on first query per session

## If something goes wrong

- `graph_status()` returns `indexed: false` after multiple queries → check Node version (`node --version` must be ≥20)
- `unresolvedEdges` is very large → `graph_index(force=true)` for a clean rebuild
- Suspicious stale data → `rm -rf <target-repo>/.aify-graph` and query again to force rebuild
- Same repo used from both Windows and WSL → native Node addons can flip platforms (`better-sqlite3` is the usual one). The server's native-module preflight auto-rebuilds on startup; manual `npm rebuild better-sqlite3` only needed if the auto-rebuild itself fails.
- Skill-specific behaviour questions → read `integrations/claude-code/skill/SKILL.md`
