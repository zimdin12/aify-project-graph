# aify-project-graph

On-demand codebase graph map for coding agents. Scans any project with tree-sitter, builds a structural graph + precomputed briefs, and hands the agent a 250-token orientation substrate instead of forcing it to explore with shell.

Measured: **1.5–2.9× faster wall-clock** and **17–35% cheaper in tokens** per agent session on orient tasks (48 live codex runs, 4 languages, 2026-04-19).

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

That's the entire install. The agent clones the repo, writes your MCP config, copies the skills, and tells you when to restart. Takes 2-3 minutes.

## Usage in one sentence

After restart, in any repo you want to navigate, say **"generate project graphs"**. The `/graph-build-all` skill builds the code graph, all briefs, and a proposed functionality map. You review the diff, accept, and every future session auto-reads the brief for 1.5-2.9× faster work.

**Narrower skills for specific jobs:**
- `/graph-build-briefs` — refresh just the briefs (~2-3s, after hand-editing `functionality.json`/`tasks.json`)
- `/graph-build-functionality` — propose/refresh the feature map (~30-60s, LLM proposal + review)
- `/graph-build-tasks` — sync tasks from your tracker (~10-60s — ClickUp/Asana/Linear/Jira/GitHub/plaintext)
- `/graph-anchor-drift` — fix stale feature anchors after renames/moves (~5-15s)
- `/graph-pull-context` — get cross-layer context for a specific symbol/file/feature/task (seconds)

**Typical full `/graph-build-all` timing**: 30-90s first run. Subsequent reindex is git-diff-aware — <100ms if nothing changed, seconds if a few files edited. Briefs regenerate in 2-3s regardless of repo size. Functionality proposal (the bottleneck) is ~30-60s for an LLM pass.

## Inspiration

Built on ideas from two sources:

- **[graphify](https://github.com/safishamsi/graphify)** (MIT) — the compact NODE/EDGE line format, named query verbs, token-budget discipline, and interface-first `GRAPH_REPORT` digest are patterns we adapted from graphify's design.
- **[Karpathy's LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)** — the concept of a persistent structured artifact between model and raw sources, with an index layer that teaches the agent how to use it.

## What we solved

The [LLM Wiki critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) identified 7 failure modes. We addressed all of them:

| Failure mode | How we solve it |
|---|---|
| **Persistent model mistakes** | No LLM in the ingest path. 100% tree-sitter deterministic extraction. |
| **Hallucinated connections** | Every edge is a real syntactic relationship. Framework-inferred edges carry lower confidence. |
| **Information loss via compression** | We store pointers (file:line), not summaries. No content is compressed. |
| **Broken source traceability** | Every node and edge carries `file_path`, `start_line`, `confidence`. |
| **Cascading update complexity** | Auto-derived from source on every query. Git-diff-aware incremental reindex. |
| **Scaling chaos** | Deterministic node IDs. Rigid typed schema. No freeform links. |
| **Stale data** | Freshness check on every query — graph always reflects current source. |

## How it compares to graphify

| | graphify | aify-project-graph |
|---|---|---|
| **Storage** | In-memory NetworkX (ephemeral) | SQLite (persistent across sessions) |
| **Scale** | ~100k nodes (Python memory limit) | 350k+ nodes tested, 1M target |
| **Freshness** | Full rebuild every run | Git-diff-aware incremental |
| **Languages** | Per-language Python extractors | Config-driven generic walker (12 langs, ~30 lines per config) |
| **Node types** | Code symbols only | Code + directories, docs, configs, routes, entry points, schemas |
| **Path tracing** | No | `graph_path` — readable execution stories |
| **Community detection** | Leiden | Louvain (same quality, JS-native) |
| **Framework awareness** | No | Plugin system (Laravel routes + middleware in v1) |
| **Dashboard** | No | Cytoscape.js interactive browser |
| **Fuzzy search** | No | `graph_search` with partial name + type + file filters |

## How it works

```
1. Agent calls graph_index() (or any query verb — auto-indexes on first call)
2. Tree-sitter parses every source file in the repo
3. Generic extractor emits nodes (Function, Class, File, Route, etc.) + edges (CALLS, IMPORTS, EXTENDS, etc.)
4. Cross-file resolver links references across files
5. Louvain community detection clusters related symbols
6. Everything persists to .aify-graph/graph.sqlite
7. Agent queries via MCP verbs — compact NODE/EDGE responses with file:line citations
8. On next query, git diff is checked — only changed files reindexed
```

The `.aify-graph/graph.sqlite` file IS the product. Like `.git/` is the product of `git init`.

## Static briefs & overlays

**Measured (2026-04-19, 48 live codex runs across 4 languages):** brief-only delivery is **1.5–2.9× faster wall-clock** and **17–35% cheaper in tokens** than live lean-MCP on orient tasks. Wall-clock speed-up is the bigger story: no shell round-trips, no model reasoning loop to pick the right tool — the agent reads once and answers. Full matrix at [docs/dogfood/ab-results-2026-04-19-deep-summary.md](docs/dogfood/ab-results-2026-04-19-deep-summary.md).

Five artifacts generated at `.aify-graph/` on every index:

- **`brief.md`** (~500 tok, human-readable) — full orientation: snapshot, entrypoints, subsystems, features, hubs with role tags, read-first list, tests, risks, recent activity.
- **`brief.agent.md`** (~350 tok, prompt substrate) — dense key/value form of the above. Paste into any agent's system/developer prompt for orient-shaped sessions.
- **`brief.onboard.md`** (~250 tok) — stripped variant focused on new-to-this-repo sessions. Drops recent activity and risks.
- **`brief.plan.md`** (~310 tok) — leads with **features + anchors**, **recent commits feature-tagged**, **open tasks grouped by feature**, and risk areas. For "about to change something" sessions.
- **`brief.json`** — machine-readable equivalent of everything.

Briefs are **cache-discipline stable** — deterministic ordering, no timestamps in the agent brief, files only rewritten when content actually changes. Prefix-cache survives across sessions while HEAD doesn't move.

### Functionality overlay (L2) — load-bearing, set up day one

> **`functionality.json` is the overlay that makes briefs work on plan tasks.** Without it, `brief.plan.md` is ~70 tokens of headers with no action-bearing content. With it, per-feature "open this file, tests are here, N callers" guidance appears and brief-only wins plan tasks by −19% tokens / −28% duration (bench data 2026-04-19). **Recommended:** run `/graph-build-all` in Claude Code — it indexes the graph, generates all briefs, and proposes `functionality.json` in one pass (30-90s). Or for a narrower step, `/graph-build-functionality` alone. On Codex/OpenCode (no skills), hand-author from [`docs/examples/functionality.sample.json`](docs/examples/functionality.sample.json) and run `node scripts/graph-brief.mjs <repo>`.

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

### Task overlay (L3)

Drop `.aify-graph/tasks.json` (written by the `/graph-build-tasks` skill) and `brief.plan.md` automatically adds an `OPEN_TASKS` section grouped by feature.

### Claude Code skills

Nine workflow skills ship at [`integrations/claude-code/skills/`](integrations/claude-code/skills/) plus one core skill at [`integrations/claude-code/skill/`](integrations/claude-code/skill/):

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
- **`/graph-walk-bugs`** — engine-out bug-fixing walk. Weighted topological order (roots first, leaves last), surfaces open bug-like tasks per feature with inclusion reasons, cycles + trust signal at end.
- **`/graph-pull-context`** — wraps `graph_pull` with intent-aware layer defaults (plan / debug / review) and a read-next summary.

Invoke any of the above as `/<skill-name>` in Claude Code.

### Regenerating

```bash
node scripts/graph-brief.mjs <repoRoot>
```

Rebuilds all five briefs + reads `functionality.json` + `tasks.json` if present. User-curated files (`functionality.json`, `tasks.json`) are preserved across full graph rebuilds (`bench-rebuild.mjs`).

## Install

### One-line agent prompt

Tell your agent:

> Read `AGENTS.md` from https://github.com/zimdin12/aify-project-graph and install it for this environment.

The agent-facing install doc is self-contained: it clones the repo, wires the MCP config for your runtime (Claude Code / Codex / OpenCode), installs the skill, and tells you the one manual step (restart).

### Manual install

```bash
git clone https://github.com/zimdin12/aify-project-graph.git
cd aify-project-graph
npm install
npm test  # verify: should be all green
```

Then register the MCP server in your agent's config:

**Claude Code** (`~/.claude/mcp.json`):
```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<path>/aify-project-graph/mcp/stdio/server.js"]
    }
  }
}
```

**Codex** (`~/.codex/mcp.json`, recommended lean profile):
```json
{
  "mcpServers": {
    "aify-project-graph": {
      "command": "node",
      "args": ["--max-old-space-size=8192", "<path>/aify-project-graph/mcp/stdio/server.js", "--toolset=lean"]
    }
  }
}
```

**OpenCode** uses the same recommended lean args.

Lean mode keeps the workflow verbs that benchmarked best on Codex/OpenCode (`graph_report`, `graph_onboard`, `graph_change_plan`, `graph_preflight`, `graph_path`, `graph_file`) and swaps exact-name lookup to `graph_lookup(symbol="X")`. If you want every low-level traversal verb in Codex/OpenCode, drop `--toolset=lean` and run the full toolset instead.

Replace `<path>` with the absolute path (forward slashes on Windows). `8192` is recommended on 16 GB+ machines; `4096` is acceptable on smaller machines.

Restart your agent. The graph builds automatically on first query.

### Install the skill (Claude Code only)

```bash
cp -r <path>/aify-project-graph/integrations/claude-code/skill \
  ~/.claude/skills/aify-project-graph
```

## Query verbs

MCP tools organized by purpose:

### Discovery — orient in a new project
| Verb | What it does | Example |
|---|---|---|
| `graph_onboard(path=".")` | Curated onboarding brief: scope stats, key files, hub symbols, test anchors, reading order | Learn a repo or subsystem efficiently |
| `graph_report()` | Full project orientation: files, languages, entry points, hub symbols, community clusters | First thing to call on any unfamiliar repo |
| `graph_search(query="UserCont")` | Fuzzy symbol search with type/file filters | Find symbols by partial name |
| `graph_whereis(symbol="get_db")` | Exact definition lookup: file:line | When you know the exact name |
| `graph_module_tree(path="src/auth")` | Directory + file + symbol hierarchy | Explore a specific area |

### Analysis — understand code before changing it
| Verb | What it does | Example |
|---|---|---|
| `graph_change_plan(symbol="get_db")` | One-shot change brief: trust, risk, caller/dependency/test signals, recommended file read order | Plan a safe multi-file change |
| `graph_preflight(symbol="get_db")` | One-shot edit safety check: location, callers, impact, test coverage, trust signal | **Call before editing any symbol** |
| `graph_file(path="src/auth/token.ts")` | Everything about one file: defines, imports, callers-in, callees-out, test coverage | Understand a file in one call |
| `graph_callers(symbol="get_db")` | Who calls this? Ranked by depth, confidence, test proximity | Before understanding usage |
| `graph_callees(symbol="handle")` | What does this call? | Before understanding dependencies |
| `graph_neighbors(symbol="User")` | All connections: calls, refs, imports, extends, tests | Full picture of a symbol |
| `graph_impact(symbol="User")` | Deep blast radius analysis via transitive edge walk | When you need full dependency tree |
| `graph_path(symbol="handleRequest")` | Trace execution path as a readable story | Understand flow end-to-end |

### Administrative
| Verb | What it does |
|---|---|
| `graph_status()` | Is graph indexed? Node/edge counts, trust signals |
| `graph_index(force=true)` | Rebuild from scratch |
| `graph_dashboard()` | Open interactive visual browser |

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
- `.aifyignore` — additional dirs to exclude on top of defaults
- `.aifyinclude` — un-exclude from defaults (e.g. `build` or `vendor` when they hold real code)

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

- **✅ Orient in an unfamiliar repo** (`graph_onboard`, `graph_report`, `graph_whereis(expand=true)`)
- **✅ Plan a non-trivial change** (`graph_change_plan`, `graph_preflight`)
- **✅ Trace execution across 3+ files when the graph models the path cleanly** (middleware chains, explicit structural flows). `graph_path` prefers `PASSES_THROUGH` middleware branches ahead of the parallel direct `INVOKES` shortcut when both exist.
- **✅ Impact/blast-radius on a symbol with non-trivial fan-in** (`graph_preflight`, `graph_callers` with class-level rollup)
- **✅ Framework-pattern navigation** — Laravel routes/traits/facades, Flecs ECS systems, Python decorators

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

- [AGENTS.md](AGENTS.md) — one-stop agent-driven install (preferred)
- [Design spec](docs/superpowers/specs/2026-04-16-aify-project-graph-design.md)
- [Install for Claude Code](install.claude.md) — human walkthrough
- [Install for Codex](install.codex.md) — human walkthrough (recommended lean profile)
- [Install for OpenCode](install.opencode.md) — human walkthrough (recommended lean profile)
- [Query format reference](SKILL.md)
- [Dogfood A/B results (2026-04-18)](docs/dogfood/ab-results-2026-04-18.md)
- [Dogfood lc-api trace rerun (2026-04-18)](docs/dogfood/ab-results-2026-04-18-lcapi-trace-expanded-rerun.md)
- [Dogfood baseline](docs/dogfood/baseline-2026-04-16.md)

## License

MIT. See [LICENSE](LICENSE).

Patterns adapted from [graphify](https://github.com/safishamsi/graphify) (MIT). See [ATTRIBUTION.md](ATTRIBUTION.md).
