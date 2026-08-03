# aify-project-graph

On-demand codebase graph map for coding agents. Scans any project with tree-sitter (12 languages), builds a structural graph + precomputed briefs (with EXPORTS list, execution PATHS, feature overlay), and hands the agent a 300-1100-token orientation substrate instead of forcing it to explore with shell.

**Honest measurement, n=1 per arm — read the caveats.** The static brief + overlay reliably beat Grep-only on planning shapes by **~15-20% wall-clock and tool calls** with structurally better feature taxonomy across multiple runs (apg dogfood + 2026-04-26 echoes A/B). That's the consistent win.

**Bounded `code_intel_*` verbs (C++, TypeScript/JS, Python) — load-bearing on REFUSING confidently-wrong absence claims.** Top-level MCP tools (`code_intel_diagnostics/references/definitions/hover/symbols/hierarchy/analyze`) drive a real language server live — clangd / typescript-language-server / pyright, auto-selected by file extension, **bundled with the plugin (no host LSP config)** — no collect/import round-trip. Per-language honesty: C++ gated on compile-DB coverage, TS exhaustive with a `tsconfig.json`, **Python never provably exhaustive** (dynamic dispatch → a verified floor). After Plan #14 (2026-05-21) they carry a structured **evidence contract**: `code_intel_references` returns `evidence: {ready, degraded, cause, confidence, fallback, exhaustive, warnings[]}`. Absence claims ("no callers", "dead code", "safe to delete") are only safe when `evidence.exhaustive === true`; otherwise the agent MUST refuse the claim or fall back per `evidence.fallback`. Degraded causes (`cold_index|timeout|definition_only|stale_index|unsupported|unknown`) name what went wrong; cold sessions auto-prewarm a bounded ≤15-file set (same-dir + `compile_commands.json` siblings only); sticky degraded state per session warns when the index quietly recovered after an earlier under-report.

**Honest finding from real-clangd validation (2026-05-22, Sand Castle WSL clangd 18.1.3):** on clangd running with `--background-index=false` (our default for determinism), `evidence.exhaustive === true` is NOT achievable through any current prewarm/wait combo — clangd doesn't emit readiness in that configuration. The contract is enforceable in the **negative direction**: refuse confident absence claims when degraded. That's still load-bearing protection (it prevents the most dangerous class of confidently-wrong "dead code" report) but the agent rarely gets to make a positive exhaustive claim from APG alone today. Future work: a workspace-symbol round-trip OR background-index opt-in for repos that can afford the indexing cost — both surface real `ready` signals.

**Measurement caveat:** the single-fixture A/B (`docs/dogfood/ab-2026-05-12-bounded-vs-collect.{txt,json}`) shows ~1.1× time, ~76% byte reduction — the **byte reduction is mechanically real**, the wall-clock parity is a fixture artifact (the demo bypasses production cold-server waits to measure tool-surface latency). On real clangd, bounded verbs pay a real first-call cold-warmup cost; subsequent calls in-session are fast. The agent-code-intel reference repo ran a 9-task T1-T9 A/B and validated empirically that this class of tool is "load-bearing on multi-level absence claims, marginal on grep-solvable cases" — APG's equivalent 6-task cpp microbench (Plan #14 Step C; harness at `scripts/code-intel-microbench.mjs`, task spec at `bench/cpp-microbench.tasks.json`) passed **6/6** on Sand Castle against real clangd 18.1.3 on 2026-05-23 (verified by graph-senior-dev). Per-task agent-productivity Δ via an LLM-driven `bench-ab.mjs` A/B remains pending: harness shipped + dry-run-tested, but real run needs a host with `claude` CLI + spend approval.

Use bounded verbs for atomic mid-edit questions; use `code_intel_analyze` when you need `clang-tidy` or compile-command syntax evidence beyond plain LSP; use `graph_packet({mode:"plan"|"verify"})` for planning and post-edit decisions. Analyzer evidence preserves `partial` / `not_collected` states so missing compile entries are not rendered as clean. Skill walkthrough: `/cpp-inner-loop`. Lean profile for C++ hosts: `--toolset=code-intel`.

Live verbs are **conditionally helpful**. Used surgically (1-3 calls per planning task), they add precision the brief can't give. Used liberally, they go net negative — the 2026-04-26 echoes A-v2 bench showed an agent making 7 live verb calls ended up +52% tokens / +15% wall-clock vs the same task done with no graph at all, because each `graph_find`/`graph_consequences`/`graph_file` returns hundreds-to-thousands of context tokens. Skill prose now hard-caps at 3 live calls per planning task.

Earlier in this round we headlined `−23.1% / 6-2 wins` from apg's self-bench. That number was real for that run but **partly inflated by silent live-verb failures pre-cwd-fix**: when the MCP server was launched from a non-repo directory, every live verb returned a cheap `trust=missing` skeleton that didn't add token weight. With the [`repo` arg fix](https://github.com/zimdin12/aify-project-graph/commit/394c1a0) shipped 2026-04-26 the contamination is gone, but it also means the apg numbers should be taken as a single point estimate, not a confident headline. n≥3 per arm is needed for defensible deltas.

**Bottom line:** briefs + overlay carry the system; live verbs help when used surgically. Multi-bench artifacts: [postfix4 (apg, contaminated)](docs/dogfood/token-cost-bench-2026-04-25-postfix4.json), [final (apg)](docs/dogfood/token-cost-bench-2026-04-26-final.json), [echoes A/B v1+v2](https://github.com/zimdin12/aify-project-graph/blob/main/docs/dogfood/) (when shared). Earlier 2026-04-20 cross-runtime data still applies for context: Claude Code Agent + Opus saw **−19% to −34% tokens** on shell-accessible tasks; Codex + gpt-5.4 roughly parity aggregate.

## Install in one paste

**Copy this into Claude Code:**

```
Read install.claude.md from https://github.com/zimdin12/aify-project-graph and install it for my environment. I will restart Claude Code when you're done.
```

**Copy this into Codex:**

```
Read install.codex.md from https://github.com/zimdin12/aify-project-graph and install it for my environment. I will restart Codex when you're done.
```

**Copy this into OpenCode:**

```
Read install.opencode.md from https://github.com/zimdin12/aify-project-graph and install it for my environment. I will restart OpenCode when you're done.
```

**Copy this into oh-my-pi / a Pi / low-resource Linux agent host:**

```
Read install.pi.md from https://github.com/zimdin12/aify-project-graph and install it for my Pi/Linux environment. I will restart the host agent when you're done.
```

**Copy this into the Hermes agent:**

```
Read install.hermes.md from https://github.com/zimdin12/aify-project-graph and install it for my environment. I will restart Hermes when you're done.
```

**Copy this into Cursor:**

```
Read install.cursor.md from https://github.com/zimdin12/aify-project-graph and install it for my Cursor environment. I will restart Cursor when you're done.
```

That's the entire install. The agent clones the repo to a pinned path (`~/.claude/plugins/aify-project-graph`, `~/.codex/plugins/aify-project-graph`, `~/.config/opencode/plugins/aify-project-graph`, or `~/.local/share/aify/plugins/aify-project-graph` depending on runtime), registers the MCP server via the runtime's CLI/config, copies skills where supported, and tells you when to restart. Takes 2-3 minutes.

**WSL + native Windows:** if you run Claude Code on Windows and Codex/OpenCode in WSL, install the tool **separately in each environment** — `better-sqlite3` is a native module and the compiled binary must match the runtime (Windows `.node` ≠ Linux `.so`). The install docs pin each runtime to its own filesystem path, so the two clones don't collide.

## Usage in one sentence

After restart, in any repo you want to navigate, say **"generate project graphs"**. The `/graph-build-all` skill first checks repo hygiene (`.gitignore` / `.aifyignore`), then builds the code graph, all briefs, and a proposed functionality map. You review the diff, accept, and every future session auto-reads the brief — see headline metrics at top of this README for runtime-specific numbers.

Important runtime behavior: **read verbs are snapshot-first**. The first query in a repo with no graph yet may bootstrap the initial snapshot. After that, reads should use the last completed graph snapshot and should not silently rebuild or mutate it during normal analysis. If the graph is incomplete or stale, the right move is an explicit `graph_index(force=true)` or relying on the static briefs until the rebuild is done.

**Narrower skills for specific jobs:**
- `/graph-build-briefs` — refresh just the briefs (~2-3s, after hand-editing `functionality.json`/`tasks.json`)
- `/graph-build-functionality` — propose/refresh the feature map (~30-60s, LLM proposal + review)
- `/graph-build-tasks` — sync tasks from your tracker (~10-60s — ClickUp/Asana/Linear/Jira/GitHub/plaintext)
- `/graph-anchor-drift` — fix stale feature anchors after renames/moves (~5-15s)
- `/graph-pull-context` — get cross-layer context for a specific symbol/file/feature/task (seconds)

**Typical full `/graph-build-all` timing**: 30-90s first run. Subsequent reindex is git-diff-aware — <100ms if nothing changed, seconds if a few files edited. Briefs regenerate in 2-3s regardless of repo size. Functionality proposal (the bottleneck) is ~30-60s for an LLM pass.

## ★ Read this before you trust an answer

This tool answers questions about code, and — more importantly — **tells you how much
to trust each answer**. That second part is the product. Two rules cover most of it.

### 1. Empty is not absent

Every evidence-bearing verb returns an `evidence` block. The only field that licenses
a "there are no callers / this is safe to delete" conclusion is:

```
evidence.exhaustive === true
```

Anything else means *the tool could not answer*, which is a statement about the index
— never about your code:

| `evidence.cause` | what it licenses |
|---|---|
| `null` + `exhaustive: true` | the absence is real; safe to act on |
| `definition_only` | the index knew the declaration and nothing else. **Not evidence of no callers.** |
| `stale_index` / `cold_no_warm` | correct answer, unattested. Re-run with `waitForReadyMs` |
| `no_index_entry` | the symbol is not in the index at all |

**On a cold session pass `waitForReadyMs` (e.g. `25000`).** A cold call can return the
*right* answer with `exhaustive: false` — same results, not licensed to act on.

### 2. On C++, treat the verbs as an evidence source, not an answer source

Measured on one 122-file C++ project (2026-08): **766 of 1599 queried symbols resolved
references (47.9%)**. Of the 833 that did not, **every one was `definition_only` and
none were true absences.** Failure is **per-symbol, not systemic** — on that repo
`cylindricalLatBandsForBody` returned all 6 of its hand-verified callsites with
`exhaustive: true`, while `SaveManager::saveGame` returned none and said so.

Check your own repo rather than assuming these numbers:
`graph_health` → `codeIntel.refsNotFoundBreakdown` reports `{total, degraded, clean}`.

Use `code_intel_references` for delete/rename decisions. `graph_callers` is
**heuristic** (tree-sitter) and undercounts C++ virtual and cross-TU dispatch — it is
a lead, not a completeness claim.

### 3. Receipts — handing a claim to another agent

`graph_pull` and `graph_consequences` return a portable `receipt`: the claim plus its
**invalidation conditions** (repo/index/server commit, compile-DB hash, overlay
content hash, worktree state) and a named cheapest disconfirming test. Replay it with
`replay.verb` + `replay.args`. **If any pinned input drifted it refuses to validate**
rather than serving a stale answer — that is the difference between a receipt and a
cache. Pass `receipt: "full"` for per-claim provenance.

### 4. Self-check: is this graph telling me the truth right now?

```
graph_health          # trust level, staleness, coverage over a NAMED denominator,
                      # which build is answering, and ≤3 ranked next actions
                      # (EMPTY on a healthy repo — that is what makes it meaningful)
```

Read `artifactAges` before believing `graph_consequences`' **inferred** fields — they
come from a curated overlay and are exactly as fresh as it is. If `trust spine EMPTY`
appears, run `graph_collect_code_intel` before trusting any "no callers" claim.

> ⚠ **`graph_collect_code_intel` deletes data.** A *complete* collect supersedes and
> discards the prior collection for that provider; a *partial* one does not. Back up
> `.aify-graph/` first if the current collection is your only copy.

## Inspiration & what we borrowed, per project

We read other tools in this space deliberately and take from them. Full detail,
including which file each idea landed in, is in **[ATTRIBUTION.md](ATTRIBUTION.md)** —
this is the summary.

| Project | License | What we took |
|---|---|---|
| **[graphify](https://github.com/safishamsi/graphify)** | MIT | The compact `NODE`/`EDGE` line response format, the high-intent named-verb surface, token-budget discipline, and the interface-first `GRAPH_REPORT` digest. |
| **[codegraph](https://github.com/colbymchenry/codegraph)** | MIT | Packet `clampToBudget` skeletonize-before-drop (collapse → header+count → drop, never dropping the target section); dynamic-dispatch **boundary detection** (announce the dispatch site instead of guessing an edge) → `query/dynamic-boundaries.js`; `new Foo()` as a caller edge; betweenness-ranked community bridges with hub exclusion. |
| **[agent-understand-anything](https://github.com/thejesh23/agent-understand-anything)** | MIT | JS/TS import-specifier resolution heuristics → `ingest/import-resolution.js`, `ingest/js-import-evidence.js`. |
| **[understory](https://github.com/thecodacus/understory)** | Apache-2.0 | The **session seed** → `mcp/stdio/session-seed.js`. Their finding: a client model that sees only *tool names* answers from its own head and never looks. The load-bearing detail is seeding with what each thing is **about**, not with filenames. |
| **agent-code-intel** | *unlicensed* | **Pattern only — no code read into ours.** Comment/string masking before regex scans (re-derived from the described idea), used in `dynamic-boundaries.js`. |
| **[Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** | — | The concept of a persistent structured artifact between model and raw sources, with an index layer that teaches the agent how to use it. We use deterministic tree-sitter extraction rather than LLM-generated content, which addresses the main [critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) of the original. |

Borrowing is measured, not assumed: several widely-recommended ideas were
**rejected after probing them against this codebase** — the analysis claimed five
C++ macro failure modes and only one reproduced; `indirect_call` recall via
`REFERENCES` edges measured too noisy to use (its top hits were std-library name
collisions); and an `isError` audit found we were already compliant. Those
non-adoptions are recorded in `docs/v0.3-hardening-plan.md` so they are not
re-litigated.

## What we solved

The [LLM Wiki critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) identified 7 failure modes. We addressed all of them:

| Failure mode | How we solve it |
|---|---|
| **Persistent model mistakes** | No LLM in the ingest path. 100% tree-sitter deterministic extraction. |
| **Hallucinated connections** | Every edge is a real syntactic relationship. Framework-inferred edges carry lower confidence. |
| **Information loss via compression** | We store pointers (file:line), not summaries. No content is compressed. |
| **Broken source traceability** | Every node and edge carries `file_path`, `start_line`, `confidence`. |
| **Cascading update complexity** | Auto-derived from source. Explicit `graph_index` rebuilds and git-diff-aware incremental reindex keep snapshots cheap to refresh. |
| **Scaling chaos** | Deterministic node IDs. Rigid typed schema. No freeform links. |
| **Stale data** | Snapshot lines and `graph_health` surface drift (`indexed` vs `HEAD`) so agents can choose rebuild vs source verification explicitly. |

## How it compares to graphify

| | graphify | aify-project-graph |
|---|---|---|
| **Storage** | In-memory NetworkX (ephemeral) | SQLite (persistent across sessions) |
| **Scale** | ~100k nodes (Python memory limit) | 350k+ nodes tested, 1M target |
| **Freshness** | Full rebuild every run | Git-diff-aware incremental |
| **Languages** | Per-language Python extractors | Config-driven generic walker (12 langs, ~30 lines per config) |
| **Node types** | Code symbols only | Code + directories, docs, configs, routes, entry points, schemas |
| **Path tracing** | No | `graph_path` — readable execution stories |
| **Community detection** | Leiden | Leiden (ngraph.leiden, MIT) — matched |
| **Framework awareness** | No | Plugin system: Laravel, Rails, Spring, NestJS, FastAPI/Flask, Express/Koa/Fastify/Hono, Qt signals/slots, Google Test + Catch2 |
| **Dashboard** | No | Cytoscape.js interactive browser |
| **Fuzzy search** | No | `graph_search` with partial name + type + file filters |

## How it works

```
1. Agent checks `.gitignore` / `.aifyignore`, then calls `graph_index()` or reads the last completed snapshot
2. Tree-sitter parses every source file in the repo
3. Generic extractor emits nodes (Function, Class, File, Route, etc.) + edges (CALLS, IMPORTS, EXTENDS, etc.)
4. Cross-file resolver links references across files
5. Leiden community detection clusters related symbols
6. Everything persists to .aify-graph/graph.sqlite
7. Agent queries via MCP verbs — compact NODE/EDGE responses with file:line citations
8. On explicit refresh, git diff is checked — only changed files reindexed
```

The `.aify-graph/graph.sqlite` file IS the product. Like `.git/` is the product of `git init`.

## Static briefs & overlays

**Honest measurement.** Briefs + overlay reliably save **~15-20% wall-clock and tool calls** vs Grep-only on planning shapes — consistent multi-run signal across apg dogfood + 2026-04-26 echoes A/B. Live verbs are conditionally helpful: surgical use (≤3 calls) adds precision the brief can't give; over-calling tips net negative because each `graph_find`/`graph_consequences`/`graph_file` returns hundreds-to-thousands of context tokens. Skill prose hard-caps at 3 live calls per planning task. Earlier `−23.1% / 6-2 wins` headline from apg postfix4 was partly inflated by silent live-verb failures pre-cwd-fix; single-run results don't justify a confident headline either way (n≥3 per arm needed). Artifacts: [postfix4](docs/dogfood/token-cost-bench-2026-04-25-postfix4.json), [final](docs/dogfood/token-cost-bench-2026-04-26-final.json). 2026-04-25 upgrade plan history: [docs/superpowers/plans/2026-04-25-upgrade-plan.md](docs/superpowers/plans/2026-04-25-upgrade-plan.md). Older 2026-04-20 cross-runtime: Claude Code + Opus saw **−19% to −34% tokens and 1.5-2.9× wall-clock**, Codex + gpt-5.4 roughly parity.

Five artifacts generated at `.aify-graph/` on every index:

- **`brief.md`** (~700-900 tok, human-readable) — full orientation: snapshot, tooling, coverage, entrypoints, EXPORTS (public API), subsystems, features, internal hubs, read-first list, tests, risks, recent activity.
- **`brief.agent.md`** (~300-1100 tok, prompt substrate) — dense key/value form including **PATHS** (pre-computed execution chains for top EXPORTS); size varies with public-API surface (apg at 21 MCP verbs + PATHS ≈ 1000 tok; small repos without explicit exports ≈ 300 tok). Paste into any agent's system/developer prompt for orient-shaped sessions. Now answers trace-shape questions from context.
- **`brief.onboard.md`** (~250-500 tok) — stripped variant focused on new-to-this-repo sessions. Drops recent activity, risks, and PATHS.
- **`brief.plan.md`** (~300-600 tok when `functionality.json` populated, ~70 tok when empty) — leads with **features + anchors**, **recent commits feature-tagged**, **open tasks grouped by feature**, and risk areas. For "about to change something" sessions.
- `brief.agent.md` now also carries `OVERLAY:` and `DIRTY:` summary lines when those signals exist, and `brief.plan.md` adds `OVERLAY GAPS:` / `DIRTY SEAMS:` sections so agents can tell whether the map is thin or whether the current bug seam is actively being edited.
- **`brief.json`** — machine-readable equivalent of everything.

Briefs are **cache-discipline stable** — deterministic ordering, no timestamps in the agent brief, files only rewritten when content actually changes. Prefix-cache survives across sessions while HEAD doesn't move.

### Functionality overlay (L2) — load-bearing, set up day one

> **`functionality.json` is the overlay that makes briefs work on plan tasks.** Without it, `brief.plan.md` is ~70 tokens of headers with no action-bearing content. With it, per-feature "open this file, tests are here, N callers" guidance appears and brief-only wins plan tasks by −19% tokens / −28% duration (bench data 2026-04-19). **Recommended:** run `/graph-build-all` in Claude Code, or use the shipped `graph-build-functionality` skill in Codex. On OpenCode (no skills), hand-author from [`docs/examples/functionality.sample.json`](docs/examples/functionality.sample.json) and run `node scripts/graph-brief.mjs <repo>`. On repos with monolithic/shared tests, add explicit `tests` arrays per feature instead of relying purely on auto-attribution.

Drop `.aify-graph/functionality.json` in any repo to map **user-defined features** to code:

```json
{
  "version": "0.1",
  "features": [
    {
      "id": "auth",
      "label": "Authentication & tokens",
      "description": "User login, API token validation, session handling.",
      "anchors": {
        "symbols": ["RequireToken.handle", "authenticate"],
        "files": ["app/Http/Middleware/RequireToken.php", "app/Http/Controllers/Api/Auth/*"]
      },
      "source": "user",
      "tags": ["http", "security"]
    }
  ]
}
```

Anchors are validated against the graph on every brief regen — stale or broken anchors surface in the brief's `TRUST` line as an actionable routing signal. Sample at [`docs/examples/functionality.sample.json`](docs/examples/functionality.sample.json).

**Map quality ceiling:** if the graph still feels thin after a clean rebuild, the next fix is usually a richer overlay, not another verb. The highest-value fields are `tests[]`, `depends_on`, `related_to`, and `anchors.docs`.

**Dirty worktree matters:** on active feature branches, graph quality depends not just on the indexed snapshot but on whether the seam you care about is currently dirty. `graph_health()` now surfaces `dirty-seams:` and the briefs surface `DIRTY:` / `DIRTY SEAMS:` so agents can see when source-of-truth reasoning should prioritize current diffs over cached map structure.

Live planning verbs also surface this now: `graph_consequences`, `graph_pull`, and `graph_change_plan` include dirty-seam / map-gap hints directly so an agent does not have to call `graph_health()` separately just to learn that the target sits inside an actively edited seam. Under `TRUST weak`, `graph_pull` is usually the better narrow live probe; `graph_consequences` should be treated as broader advisory context, not proof. `graph_pull` accepts raw feature ids plus explicit overlay prefixes like `feature:terrain-generation`, `feature/terrain-generation`, `task:CU-123`, and `task/CU-123`.

### Task overlay (L3)

Drop `.aify-graph/tasks.json` (written by the `/graph-build-tasks` skill) and `brief.plan.md` automatically adds per-feature task lines. Task links now carry strength tiers too:
- `strong` — direct code/tracker binding (`tag:`, `commit:`, `branch:`, `path:`)
- `mixed` — several weaker but consistent signals
- `broad` — future/spec/title-only mapping that improves coverage but is not code-anchored

That keeps coverage high without pretending every planning task is hard implementation proof.

### Claude Code skills

Thirteen workflow skills ship at [`integrations/claude-code/skills/`](integrations/claude-code/skills/) plus one core skill at [`integrations/claude-code/skill/`](integrations/claude-code/skill/), including `/cpp-inner-loop` (C++ trust-spine workflow) and `/graph-build-intelligence` (opt-in semantic layer):

**Build / refresh:**
- **`/graph-build-all`** — first-time setup / full refresh (graph + briefs + functionality proposal). 30-90s first run, incremental thereafter.
- **`/graph-build-briefs`** — regenerate briefs only (~2-3s). After hand-editing overlay files.
- **`/graph-build-functionality`** — propose or refresh `functionality.json` from graph + docs + commit vocabulary. Shows diff; preserves user edits.
- **`/graph-build-tasks`** — source-agnostic task→feature sync (ClickUp, Asana, Linear, Jira, GitHub Issues, plaintext).

**Edit (surgical mutation):**
- **`/graph-feature-edit`** — add / edit / link / unlink / rename / merge / remove a single feature. Validates anchors; diff before write; auto-regen briefs.
- **`/graph-task-edit`** — same for tasks.

**Repair:**
- **`/graph-anchor-drift`** — detect stale feature anchors from a diff / git range and propose targeted patches.

**Work:**
- **`/graph-guide`** — optional workflow guide: general usage info plus example loops for orienting, planning, debugging, rebuilding, and map enrichment.
- **`/graph-walk-bugs`** — engine-out bug-fixing walk. Weighted topological order (roots first, leaves last), surfaces open bug-like tasks per feature with inclusion reasons, cycles + trust signal at end.
- **`/graph-pull-context`** — wraps `graph_pull` with intent-aware layer defaults (plan / debug / review) and a read-next summary.

**Visualize:**
- **`/graph-dashboard`** — launches the 2D multi-layer interactive dashboard in your browser. Shows code + features + tasks + docs with cross-layer edges. Curated edges (feature anchors, depends_on) are dashed blue; inferred edges (doc MENTIONS) are dotted green. Layer toggle panel on the left. Works in lean and full profile.

Invoke any of the above as `/<skill-name>` in Claude Code.

### Regenerating

```bash
node scripts/graph-brief.mjs <repoRoot>
```

Rebuilds all five briefs + reads `functionality.json` + `tasks.json` if present. User-curated files (`functionality.json`, `tasks.json`) are preserved across full graph rebuilds (`bench-rebuild.mjs`).

### Auto-reindex on commit (optional)

```bash
node scripts/install-hooks.mjs <repoRoot>          # install
node scripts/install-hooks.mjs <repoRoot> --remove # uninstall
```

Installs a git `post-commit` hook that runs `ensureFresh` + regenerates briefs in the background after every commit. The hook returns immediately so commits stay fast; reindex output lands in `.aify-graph/hook.log`. Idempotent — re-running replaces our own hook. Refuses to overwrite a foreign `post-commit` hook unless you pass `--force`.

## Install

The preferred install is agent-driven (see "Install in one paste" at the top). The agent reads the runtime-specific install doc and executes every step.

Under the hood each install doc does the same thing:

1. Clones to a pinned path inside the runtime's home
   - Claude Code: `~/.claude/plugins/aify-project-graph`
   - Codex: `~/.codex/plugins/aify-project-graph`
   - OpenCode: `${XDG_CONFIG_HOME:-~/.config}/opencode/plugins/aify-project-graph`
   - oh-my-pi / Pi-Linux: `~/.local/share/aify/plugins/aify-project-graph`
   - Hermes: `${XDG_CONFIG_HOME:-~/.config}/hermes/plugins/aify-project-graph`
   - Cursor: `~/.cursor/plugins/aify-project-graph`
2. Runs `npm install && npm test` (the full suite should pass; the exact count changes as coverage grows)
3. Registers the MCP server via the runtime's native CLI or config
   - Claude Code: `claude mcp add aify-project-graph --scope user -- node --max-old-space-size=8192 <path>/mcp/stdio/server.js` (writes to `~/.claude.json` — the CLI-managed location, not `~/.claude/settings.json`)
   - Codex: `codex mcp add aify-project-graph -- node --max-old-space-size=8192 <path>/mcp/stdio/server.js --toolset=lean`
   - OpenCode: JSON-patch `${XDG_CONFIG_HOME:-~/.config}/opencode/opencode.json` → `mcp.aify-project-graph`
   - oh-my-pi / Pi-Linux: native CLI or OpenCode-style JSON patch (see `install.pi.md`)
   - Hermes: `hermes mcp add` CLI form, or YAML-patch `$HERMES_HOME/config.yaml` (default `~/.hermes/config.yaml`) → `mcp_servers.aify-project-graph` — then ALSO add `mcp-aify-project-graph` to `platform_toolsets.cli` or the tools stay filtered out of CLI/managed sessions (see `install.hermes.md` Step 2b). Server stanza is runtime-agnostic.
   - Cursor: JSON-patch `~/.cursor/mcp.json` → `mcpServers.aify-project-graph` + optional `.cursor/rules/aify-graph.mdc`
4. Copies skills to the runtime's skill dir — Claude Code: `integrations/claude-code/skill{,s}/` → `~/.claude/skills/`; Codex: `integrations/codex/skill{,s}/` → `~/.codex/skills/`; Hermes: `integrations/hermes/skill{,s}/` → `$HERMES_HOME/skills/` (default `~/.hermes/skills/`, the same home as `config.yaml` — NOT `~/.config/hermes/`). OpenCode skips; MCP verb descriptions carry the guidance there.
5. User restarts the runtime

**Lean profile** (`--toolset=lean`) exposes 6 visible verbs on `tools/list` (`graph_packet`, `graph_consequences`, `graph_pull`, `graph_change_plan`, `graph_health`, `graph_watch`). The other verbs stay callable by name via `tools/call` — hiding them from the manifest cuts Codex/OpenCode tool-surface tax without losing functionality. Claude Code uses the **focused `default` profile** (17 verbs), not `full`; legacy orient aliases and the analytics/code-intel long tail stay hidden from `tools/list` and remain callable by name. `graph_packet` is the one-shot context primitive: feature/task targets read overlay+brief JSON directly with no freshness rebuild; bare symbol targets may use one budgeted lookup to map symbol→feature. Pass `mode=orient|plan|debug|review|audit|verify` to shape the packet for the workflow, then escalate to `graph_consequences`/`graph_change_plan` when packet's coarse view loses the depth you need.

**`verify` mode (2026-05-09):** post-edit decision packet. Inputs: `files[]` and/or `since:<git-ref>`, optional `audited`. Output includes changed files, post-edit diagnostics from any imported code-intel collection, freshness verdict, partial-state distinction (`CODE_INTEL partial: ...`), and a `SOURCE_REQUIRED` warning when `audited:true` is passed. When no code-intel is imported the packet says so explicitly (`code_intel unavailable (no_collection)`) — silence never reads as zero. Walk-through: `node scripts/demo-verify-ab.mjs`. See [superplan completion summary](docs/superpowers/specs/2026-05-09-superplan-completion-summary.md).

**Platform note.** `better-sqlite3` is a native module. If the same clone is shared across Windows and WSL, the binary flips platforms — but the MCP server has a **native-module preflight** that detects this on startup and auto-runs `npm rebuild better-sqlite3` once before accepting tool calls. You'll see one line on stderr when it triggers. Manual intervention only if auto-rebuild itself fails (e.g. missing compiler). `8192` MB Node heap suits 16 GB+ machines; `4096` is fine on 8 GB.

For the full step-by-step per runtime see [`install.claude.md`](install.claude.md), [`install.codex.md`](install.codex.md), [`install.opencode.md`](install.opencode.md), [`install.pi.md`](install.pi.md) (oh-my-pi), [`install.hermes.md`](install.hermes.md), [`install.cursor.md`](install.cursor.md). They are agent-executable — paste the "Install in one paste" prompt above and the agent follows them.

Marketplace metadata lives in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `.agents/plugins/marketplace.json`. Validate packaging with `npm run validate:marketplace`.

## Code-intel precision subsystem (v0.2)

APG remains the graph/packet brain. The 2026-05-09 superplan promotes code-intel from "optional bolt-on" to a first-class precision-evidence subsystem behind a stable provider boundary, with C++ as the headline language. The packet itself is the unified LSP for agents — code-intel facts ride inside `graph_packet` output with provenance, freshness, and three-state result rendering.

**Wrapper CLI** (added `bin/apg.js`, `bin/aify-code-intel.js` shim):

```bash
# Run a real clangd-backed collection against a C++ repo with compile_commands.json
node ./bin/apg.js code-intel collect cpp --project-root /path/to/cpp/repo --json > collection.json

# Or use the doctor subcommand to see prerequisite status with fix hints
node ./bin/apg.js code-intel doctor cpp
```

**MCP verb** (agents and bridge UI both call this; never auto-runs):

```jsonc
{ "tool": "graph_collect_code_intel", "args": { "language": "cpp", "scope": "all" } }
```

On success the v0.2 collection is imported into the local graph and immediately visible to:
- `graph_health.codeIntel` — provider, status, freshness basis
- `graph_pull(layers:["code_intel"])` — defs/refs/hovers for a symbol
- `graph_change_plan` — affected files ranked with `provenance: 'CODE_INTEL' | 'EXTRACTED'`
- `graph_packet({mode:'verify', ...})` — EVIDENCE block + diagnostics + SOURCE_REQUIRED

Schemas: [record v0.2](docs/schemas/code-intel-record.v0.2.schema.json), [collection envelope v0.2](docs/schemas/code-intel-collection.v0.2.schema.json), [provider contract](docs/integrations/code-intel-provider-contract.md). The legacy v0.1 path (`tools/code-intel/cpp-clangd/extract.mjs` + `scripts/import-code-intel.mjs`) still works unchanged for source-scan-only ingestion.

## Code-intel trust spine (clangd / typescript-language-server / pyright — optional, but load-bearing)

Code-Intel v2 (delivered 2026-05; status doc `docs/code-intel-v2-status.md`, historical records under `docs/code-intel-v2/`) adds a cohesive **trust spine** on top of a real language server. The point: separate LSP ground-truth from tree-sitter heuristics so an agent knows exactly when it can make a confident absence claim ("no callers", "dead code", "safe to delete") and when it must verify. C++ was the headline language; **TypeScript/JavaScript (typescript-language-server) and Python (pyright) backends landed 2026-06-02** behind the same provider boundary + evidence contract — language is auto-selected by file extension, the servers are bundled with the plugin (no host LSP config), and the verbs/`graph_collect_code_intel` work identically. Honesty differs per language: C++ gated on compile-DB coverage, TS exhaustive with a `tsconfig.json`, Python never provably exhaustive (dynamic dispatch) → a verified floor. See `docs/superpowers/specs/2026-06-02-multi-language-lsp-backends-design.md`.

**The trust model — read this before quoting graph results on C++:**
- **`[lsp✓]` marker + `LSP_VERIFIED` provenance = clangd ground truth.** When `graph_callers` / `graph_pull` render `[lsp✓]` on an edge (or an edge carries `LSP_VERIFIED`), that caller was resolved by clangd, not guessed. **Don't re-grep it.** A TRUST banner summarizes evidence + exhaustiveness for the response.
- **Absence claims are gated on exhaustive evidence.** `code_intel_references` returns an `evidence` object (`{ready, degraded, cause, confidence, fallback, exhaustive, warnings[]}`). Only an empty refs list with `evidence.exhaustive === true` justifies "no callers". Otherwise the verb refuses the claim and names the fallback. The empty-result paths of `graph_callers` / `graph_callees` / `graph_neighbors` / `graph_impact` now route through the same trust line, so "NO CALLERS" never prints without the not-exhaustive caveat.
- **References and hierarchy are the trustworthy core.** `code_intel_references` and `code_intel_hierarchy` (call + type hierarchy, virtual overrides) don't depend hard on the toolchain sysroot, so they stay reliable where fresh/exhaustive. **Diagnostics and hover are weaker on Windows** when the `compile_commands.json` was built under WSL/Linux (its include/sysroot paths don't exist on the Windows host). `--query-driver=*` recovers many cases; for full-quality diagnostics set **`APG_CLANGD_WSL=1`** to run clangd under WSL against the original Linux DB (opt-in; locations round-trip back to Windows paths). Verified on echoes: 90 bogus-cascade diagnostics on Windows clangd → 15 clean (only a genuine `windows.h`-not-found) under WSL. See the status doc's "Known issues" #3.

**What's in the spine:** clangd compile-db normalization (WSL→host) + unity-build expansion (engine *and* test TUs) + Windows foreign-toolchain handling; clangd refs promoted to `LSP_VERIFIED` graph edges with readiness-gated cross-TU resolution; static virtual-override edges (`OVERRIDDEN_BY`, `provenance:'INFERRED'`) for vtable-heavy engine code; the C++↔GLSL shader bridge (`graph_shader`); and an MCP `initialize` server-instructions playbook (`mcp/stdio/server-instructions.js`) that injects the intent-routed trust guidance into the host system prompt once per session, reaching Hermes + Claude Code identically. One `storage/taxonomy.js` registry and a unified trust vocabulary (lsp-verified / partial / heuristic) keep it reading as one system.

**clangd setup (optional):** the spine resolves clangd in this order — `APG_CLANGD` env var (explicit path), then `C:/Program Files/LLVM/bin/clangd.exe` on Windows, then `clangd` on PATH. Set `APG_CLANGD` if your install is elsewhere or you want a specific build. For a WSL/Linux-built compile DB on Windows, set **`APG_CLANGD_WSL=1`** to run clangd under WSL for full stdlib diagnostics/hover (or `=auto` to engage only when a foreign DB is detected and WSL+clangd are available; default OFF, Windows path unchanged). Run `node ./bin/apg.js code-intel doctor cpp` for a prerequisite report with fix hints. Skill walkthrough: `/cpp-inner-loop`. Lean profile for C++ hosts: `--toolset=code-intel`.

## Query verbs

MCP tools organized by purpose. **Profiles gate the `tools/list` surface, never the callable set** — every verb stays invokable via `tools/call` regardless of profile; profiles only shape which verbs are *listed* (agents under-pick from big lists, so the default is deliberately focused).

- **`default`** (no `--toolset`/`AIFY_GRAPH_PROFILE`) — the focused **~15 intent verbs** an agent actually reaches for: `graph_packet`, `graph_pull`, `graph_consequences`, `graph_callers`, `graph_impact`, `graph_trace`, `graph_explore`, `graph_explain_diff`, `graph_digest`, `graph_search`, `graph_whereis`, `graph_health`, `graph_collect_code_intel`, `code_intel_references`, `code_intel_hierarchy`. Everything else stays callable but unlisted.
- **`full`** (`--toolset=full`) — the whole API; lists **31 verbs** (legacy aliases + analytics/code-intel long-tail stay callable-by-name but hidden so the listed set reads as one coherent product).
- **`code-intel`** (`--toolset=code-intel`) — the clangd-backed bounded verbs (lean profile for C++ hosts).
- **`lean`** (`--toolset=lean`) — the 6-verb planning core (Codex/OpenCode).

Precedence: explicit `--toolset=<name>` > `AIFY_GRAPH_PROFILE` env > `default`.

**`APG_MCP_TOOLS`** (comma-separated env allowlist, for A/B ablation) — when set, restricts the *listed* tools to exactly that set, intersected with the resolved profile. Omitted verbs are truly absent from `tools/list` but stay callable. Example: `APG_MCP_TOOLS=graph_packet,graph_pull,graph_consequences`.

### Orientation & analytics — understand the whole repo

`graph_digest` is the one analytics front door — it returns the dashboard's whole analytic value (layers/communities, god-node hotspots, shader-binding + provenance %, tightest import cycles, community bridges) in ~1–2k tokens. Read the static briefs first; `graph_digest` is the live complement.

| Verb | What it does | Example |
|---|---|---|
| `graph_digest()` | **PRIMARY orientation.** Token-budgeted project digest — composes overview + hotspots + cycles | Orient on an unfamiliar repo in one call |
| `graph_overview()` | Cluster map (community→layer→top-dir aggregation) — *callable, hidden from list* | Legible front door at 10k+ files |
| `graph_hotspots()` | God-node / high-fan-in ranking — *callable, hidden from list* | Find the symbols everything depends on |
| `graph_cycles()` | Tightest import/include cycles — *callable, hidden from list* | C++ header-tangle detection |
| `graph_search(query="UserCont")` | Fuzzy symbol search with type/file filters | Find symbols by partial name |
| `graph_whereis(symbol="get_db")` | Exact definition lookup: file:line | When you know the exact name |
| `graph_onboard(path=".")` / `graph_report()` | Legacy compatibility orientation — *callable, hidden from list* | Live fallback when briefs are missing/stale |

### Tracing & source bundling

| Verb | What it does | Example |
|---|---|---|
| `graph_trace(from="A", to="B")` | Whole call path in one call, hop bodies inlined (`cat -n`); smart failure path inlines both endpoints + callers/callees instead of 404 | Trace A→B end-to-end, dynamic-dispatch bridges annotated |
| `graph_explore(symbols=["X","Y"])` | Multi-symbol verbatim-source bundler in one budget-capped call, grouped by file — "treat as already Read" | Kill the Read-spiral on a known symbol set |
| `graph_explain_diff(range="HEAD~3..HEAD")` | Reverse of `consequences` — keyed on a git diff/PR: changed components → affected layers → risk score | Reviewer / PR-impact gap |

### Analysis — understand code before changing it
| Verb | What it does | Example |
|---|---|---|
| `graph_change_plan(symbol="get_db")` | One-shot change brief: trust, risk, caller/dependency/test signals, recommended file read order | Plan a safe multi-file change |
| `graph_preflight(symbol="get_db")` | One-shot edit safety check: location, callers, impact, test coverage, trust signal | **Call before editing any symbol** |
| `graph_file(path="src/auth/token.ts")` | Everything about one file: defines, imports, callers-in, callees-out, test coverage | Understand a file in one call |
| `graph_callers(symbol="get_db")` | Who calls this? Ranked by depth, confidence, test proximity | Before understanding usage |
| `graph_callees(symbol="handle")` | What does this call? | Before understanding dependencies |
| `graph_neighbors(symbol="User")` | All connections: calls, refs, imports, extends, tests | Full picture of a symbol |
| `graph_impact(symbol="User")` | Deep blast radius analysis via transitive edge walk. For transitive + LSP-exhaustive results use `code_intel_hierarchy` | When you need full dependency tree |
| `graph_path(symbol="handleRequest")` | Trace execution path as a readable story | Understand flow end-to-end |

### C++ code-intel (clangd-backed — the trust spine)

See ["C++ code-intel trust spine"](#c-code-intel-trust-spine-clangd-optional-but-load-bearing) below for the full story. clangd is **optional**; references/hierarchy are the trustworthy core.

| Verb | What it does | Example |
|---|---|---|
| `code_intel_references(file,line,col)` | Symbol-aware refs via clangd, NOT text search. Carries the `evidence` exhaustiveness contract | Trustworthy "no callers" / deletion-safety |
| `code_intel_definitions/hover/symbols/diagnostics` | Jump-to-def across TUs / type at position / file outline / per-file build errors without a build | Atomic mid-edit C++ questions |
| `code_intel_hierarchy(symbol,kind)` | Call + type hierarchy — who-calls-transitively, virtual overrides. The trustworthy transitive path | Virtual-dispatch + transitive callers |
| `graph_collect_code_intel(language="cpp")` | Run a clangd collection, import it; `graph_callers` / `graph_pull(layers:["code_intel"])` then render `[lsp✓]` + LSP_VERIFIED caller edges | Repo-wide compiler-backed evidence |
| `graph_shader()` | C++↔GLSL shader-binding bridge (`DECLARES_BINDING` / `LOADS_SHADER`) — the binding seam no other tool crosses | Find CPU declarers/loaders of a shader binding |

### Administrative
| Verb | What it does |
|---|---|
| `graph_status()` | Is graph indexed? Node/edge counts, trust signals |
| `graph_index(force=true)` | Rebuild from scratch |
| `graph_dashboard()` | Open interactive visual browser (overview drill-in, blast-radius, shader sub-view, provenance ribbon) |

## Response format

All query verbs return compact line format with file:line citations:

```
NODE 5d9e7ebe function get_db service/db.py:217
EDGE abc123→5d9e7ebe CALLS service/routers/api_v2.py:918 conf=0.95
EDGE def456→5d9e7ebe CALLS service/import_v2.py:14 conf=0.95
TRUNCATED 32 more (use top_k=20)
```

Path traces return indented stories:

```
PATH handleRequest src/server.ts:10
  -> validateToken src/auth.ts:12 conf=0.95
    -> jwt.verify external:0 conf=0.80
  -> User.findById src/models/user.ts:34 conf=0.90
    -> db.query src/db.ts:12 conf=1.00
```

## Languages

12 languages supported via config-driven generic extractor:

| Tier | Languages | Accuracy |
|---|---|---|
| **Tier 1** (90%+) | Python, JavaScript, TypeScript, Go, Ruby, Java | Explicit imports + clear structure |
| **Tier 2** (70-85%) | PHP (incl. traits/enums/interfaces, member/static/nullsafe calls, namespace-based module qname), C, C++ (incl. out-of-class `Class::method` definitions), Rust | Framework magic or preprocessor gaps |
| **Tier 3** (60-70%) | C++ templates (specialisations `Foo<int>::bar` not yet handled), GLSL, CSS | Template-heavy C++, shader/style subset |

Adding a new language = writing a ~30-line config file.

Project-level escape hatches at repo root:
- `.gitignore` — add `.aify-graph/` here so derived graph state is not committed
- `.aifyignore` — additional dirs or path/glob patterns to exclude on top of defaults
- `.aifyinclude` — un-exclude from defaults (e.g. `build` or `vendor` when they hold real code)

**Framework-specific ignore recipes** (defaults already exclude `node_modules`, `vendor`, `.venv`, `build`, `dist`, etc.):

```sh
# Laravel — paste into .aifyignore at repo root
bootstrap/cache
storage/framework
storage/logs
storage/debugbar
public/build
public/hot
public/storage
_ide_helper.php
_ide_helper_models.php
.phpunit.result.cache

# Django / Python web — paste into .aifyignore
staticfiles
media
.mypy_cache
.ruff_cache

# Next.js — paste into .aifyignore (.next is already default-ignored)
.vercel
out
```

Sample feature overlay for Laravel: `docs/examples/functionality.sample.laravel.json`.

## Token cost — what the map costs vs what it displaces

The product only makes sense if querying the map is cheaper than reading the
code. Measured 2026-07-27 on this repo (`chars/4` proxy — rough in absolute
terms, but consistent across rows, which is what a comparison needs):

| | tokens |
|---|---:|
| `graph_search` | 70 |
| `graph_whereis` | 73 |
| `graph_packet(orient)` | 136 |
| `graph_callers` | 329 |
| **reading ONE source file instead** (313 lines) | **4,557** |
| `brief.agent.md` (orientation, read once) | 1,405 |
| fixed cost: MCP instructions + session seed | 3,118 |

A verb call is **14–65× cheaper than a single `Read`**, so the map pays for its
fixed cost on the **first avoided file read**.

**The honest limit of this number:** it measures *cost per call*, not *substitution
rate*. If an agent reads the file anyway, the map is pure overhead; one
substitution and it has already paid. Whether agents actually substitute is an
agent-behaviour measurement (`scripts/ab-runner.mjs`, `bench-ab.mjs`) that has
**not** been run end-to-end — see the caveat under *A/B Test Results*. Treat the
table as "the economics are sound", not as a productivity claim.

## Performance

Cold rebuild numbers from the 2026-04-18 dogfood run:

| Repo | Nodes | Edges | Rebuild time | Peak RSS | Unresolved edges |
|---|---:|---:|---:|---:|---:|
| aify-project-graph | 892 | 1,750 | 7s | 136 MB | 4,574 |
| aify-claude | 827 | 2,726 | 8s | 143 MB | 7,708 |
| mem0-fork | 8,840 | 31,630 | 129s | 347 MB | 66,504 |
| lc-api | 16,253 | 56,849 | 152s | 455 MB | 42,832 |
| echoes_of_the_fallen | 6,415 | 18,920 | 129s | 328 MB | 6,534 |

These are warmup rebuilds, not steady-state query latency. Incremental/noop sessions are much cheaper than these cold passes.

## A/B Test Results

Controlled Codex A/B with identical prompts, same model (`gpt-5.4`), same reasoning (`medium`). There are now three relevant artifacts:

- Full MCP profile broad run (`N=3`): [docs/dogfood/ab-results-2026-04-18.md](docs/dogfood/ab-results-2026-04-18.md)
- Lean MCP profile broad run (`N=3`): [docs/dogfood/ab-results-2026-04-18-lean.md](docs/dogfood/ab-results-2026-04-18-lean.md)
- Lean exact-lookup rerun (`N=5`): [docs/dogfood/ab-results-2026-04-18-lean-search-n5.md](docs/dogfood/ab-results-2026-04-18-lean-search-n5.md)

The original `lc-api` trace prompt in the full-profile run was underspecified, so the published Laravel trace row below still uses the corrected rerun in [docs/dogfood/ab-results-2026-04-18-lcapi-trace-expanded-rerun.md](docs/dogfood/ab-results-2026-04-18-lcapi-trace-expanded-rerun.md).

### Lean-profile takeaway

- The broad full-profile run was structurally honest but paid too much passive tool-surface tax on Codex/OpenCode.
- The lean follow-up improved the **overall median task-cell delta** from `+3.6%` to **`-1.0%`**.
- Lean preserved the strongest use case: orient/onboard still won with a category median of **`-7.9%`**.
- Lean repaired one of the clearest quality misses from the original broad run: `aify-claude / dispatch-request-trace` went from a graph-side regression to `C3/P0/W0`.
- Exact-lookup results under lean are best described as **near parity to small-win**, not as a universal headline. The higher-`N` exact-lookup rerun landed at **`-0.2%` median** and **`-17.8%` average**, but that category remains cache-sensitive enough that hero numbers are not stable.

### What The Full-Profile 2026-04-18 Run Showed

| Task shape | Measured result | What it means |
|---|---|---|
| **Orient / onboard** | `4/5` repos cheaper. Average `-20.7%`, median `-17.8%`. `echoes` was the exception at `+16.6%`. | Strongest current use case. The graph helps most when it can rank entrypoints, hubs, and reading order. |
| **Search / exact lookup** | `1/5` repos cheaper. Median `+3.6%` loss. Average `-14.4%` is dominated by one huge Laravel win (`lc-api` `-94.2%`). | Usually still grep/read territory. The graph can win when namespace/framework structure makes the direct jump unusually cheap. |
| **Trace / multi-file chain** | Mixed and not a headline win yet. After correcting the Laravel trace prompt, `1/5` repos got cheaper, `4/5` got more expensive. Average `+3.6%`, median `+4.5%`. | Useful only when the graph models the path cleanly. Do not promise generic trace savings today. |

- Overall average token delta after replacing the bad Laravel trace row: **`-10.5%`**, but the overall **median task-cell delta was `+3.6%`**. The average is skewed by the `lc-api` search outlier.
- Wall-clock time in this harness got worse across every category: search `+24.0%`, trace `+101.3%`, orient `+198.5%`.
- Tool ops still fell overall (`-6.5%`) and more noticeably on orient tasks (`-16.7%`), which matters for agent back-and-forth even when elapsed time does not improve.
- The most important quality regression in the run was `aify-claude` trace: graph-enabled runs were only `1/3` correct versus baseline `3/3`.

The practical takeaway is simple: the graph is paying for itself when structure is the bottleneck, not when the task is “find one line fast.”

### Per-Repo Snapshot (2026-04-18)

| Repo | Search Δ | Trace Δ | Orient Δ | Notes |
|---|---:|---:|---:|---|
| aify-project-graph | `+3.8%` | `+10.6%` | `-20.1%` | Small repo. Orient benefits, but exact lookup and trace do not. |
| aify-claude | `+3.6%` | `+4.5%` | `-11.6%` | Search/trace both worse. Graph trace quality regressed (`1/3` correct vs baseline `3/3`). |
| mem0-fork | `+11.1%` | `-6.0%` | `-17.8%` | Good example of graph helping a structural trace and orient task, but not exact lookup. |
| lc-api | `-94.2%` | `+2.7%`* | `-70.5%` | Huge exact-lookup win on a namespaced Laravel controller. `*` trace comes from the corrected expanded-middleware rerun and was equal-quality on both sides. |
| echoes_of_the_fallen | `+3.6%` | `+6.3%` | `+16.6%` | Current C++ prompts still favor grep/read more than the graph on both trace and orient. |

### When to use the graph

- **✅ Orient in an unfamiliar repo** (read `brief.agent.md` first; use `graph_onboard` / `graph_report` only as live fallbacks)
- **✅ Plan a non-trivial change** (`graph_change_plan`, `graph_preflight`)
- **✅ Trace execution across 3+ files when the graph models the path cleanly** (middleware chains, explicit structural flows). `graph_path` prefers `PASSES_THROUGH` middleware branches ahead of the parallel direct `INVOKES` shortcut when both exist.
- **✅ Impact/blast-radius on a symbol with non-trivial fan-in** (`graph_preflight`, `graph_callers` with class-level rollup)
- **✅ Framework-pattern navigation** — Laravel, Rails, Spring, NestJS, FastAPI/Flask, Express/Koa/Fastify/Hono, Qt signals/slots, Google Test + Catch2, Python decorators

### When grep/read is fine (or better)

- ❌ Find a single known symbol by exact name, especially on small repos
- ❌ Linear call chains in one file
- ❌ Dynamic dispatch that static analysis can't see (service-container resolution, reflection, metaclasses)
- ❌ Framework/vendor internals outside the indexed repo boundary

### Honest limits remaining

- **Exact-lookup remains cache-sensitive**: the full MCP profile paid too much passive tool tax on Codex/OpenCode, which is why the recommended install now uses `--toolset=lean`. Under lean, exact-name lookups moved much closer to parity, but the category still does not justify big savings claims.
- **Trace-task quality is not monotonic**: the graph is a navigation aid, not an autopilot. `aify-claude`’s `POST /dispatch` trace regressed with graph available, which is why source reads still decide correctness.
- **Inherited framework entrypoints outside the repo**: some middleware classes override template hooks like `handleRequest()` but inherit the public `handle()` entrypoint from a base class outside the indexed tree. Those hops may still surface as honest `External` boundaries unless an in-repo ancestor defines the entrypoint.
- **Two-phase framework enrichment**: Laravel route/middleware expansion now works via symbolic late binding. A second post-extraction plugin pass would generalize cleaner framework-native chains to FastAPI/Express/NestJS-style patterns and reduce remaining shortcut/external fallbacks.
- **C++ templates** `Foo<T>::bar()` now work for single-template cases, but nested templates and SFINAE specializations are still regex/AST-limited.
- **Dynamic dispatch** (`app(Foo::class)`, `$factory->create($kind)`, Python reflection): captured where statically declared (Item 4 heuristics), invisible otherwise.
- **Earlier releases** over-counted nodes on repos containing `.claude/worktrees/` or `build/_deps/`. Current release excludes those by default. If your project legitimately keeps code under `build/` or `vendor/`, use `.aifyinclude` to opt back in.

### Dogfood Rebuilds (2026-04-18)

| Repo | Nodes | Edges | Rebuild | Peak RSS | Unresolved edges |
|---|---:|---:|---:|---:|---:|
| aify-project-graph | 892 | 1,750 | 7s | 136 MB | 4,574 |
| aify-claude | 827 | 2,726 | 8s | 143 MB | 7,708 |
| mem0-fork | 8,840 | 31,630 | 129s | 347 MB | 66,504 |
| lc-api | 16,253 | 56,849 | 152s | 455 MB | 42,832 |
| echoes_of_the_fallen | 6,415 | 18,920 | 129s | 328 MB | 6,534 |

Numbers reflect the full extractor stack: out-of-class C++ methods, PHP traits/enums/interfaces/namespace-based modules, member+static+nullsafe PHP calls, facade + `app(X::class)` + constructor-DI REFERENCES, GLSL shader functions, CSS class selectors, flecs ECS lambda component types, External boundary nodes for unresolved cross-module references, and family-gated cross-language resolution.

## Detailed docs

- [AGENTS.md](AGENTS.md) — shared install reference (Claude Code / Codex / OpenCode)
- [Design spec](docs/superpowers/specs/2026-04-16-aify-project-graph-design.md)
- [Install for Claude Code](install.claude.md) — agent-executable
- [Install for Codex](install.codex.md) — agent-executable (lean profile)
- [Install for OpenCode](install.opencode.md) — agent-executable (lean profile)
- [Install for Pi / low-resource Linux](install.pi.md) — agent-executable base install plus optional C++ code-intel import
- [Core skill / query format reference](integrations/claude-code/skill/SKILL.md)
- [Code-intel JSONL schema](docs/schemas/code-intel-record.schema.json)
- [Dogfood cross-tester + Phase 2 (2026-04-20)](docs/dogfood/ab-results-2026-04-20-cross-tester.md) — **current headline evidence**
- [Dogfood improvement analysis (2026-04-20)](docs/dogfood/ab-results-2026-04-20-improvement-analysis.md)
- [Pre-launch re-analysis (2026-04-20)](docs/dogfood/ab-2026-04-20-reanalysis.md)
- [Dogfood A/B results (2026-04-18)](docs/dogfood/ab-results-2026-04-18.md) — historical
- [Dogfood lc-api trace rerun (2026-04-18)](docs/dogfood/ab-results-2026-04-18-lcapi-trace-expanded-rerun.md) — historical
- [Dogfood baseline (2026-04-16)](docs/dogfood/baseline-2026-04-16.md) — historical

## License

MIT. See [LICENSE](LICENSE).

Patterns adapted from [graphify](https://github.com/safishamsi/graphify) (MIT). See [ATTRIBUTION.md](ATTRIBUTION.md).
