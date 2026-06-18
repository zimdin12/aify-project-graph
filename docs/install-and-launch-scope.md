# Install & launch scope — design notes

Captures the 2026-06 field friction: launching the dashboard felt clunky, and
the install story is unclear when the user **doesn't have the project on disk**,
wants a **per-project** install, or a **global / user-scope** one.

## How it works today

- APG is a **per-repo MCP server**. It binds to ONE `repoRoot` — the cwd the
  runtime was launched from — and reads/writes that repo's `.aify-graph/`.
- "Install" = registering the MCP server in the runtime config (see `AGENTS.md`).
  Registration can be **project-scoped** (in the repo's `.mcp.json`) or
  **user-scoped** (e.g. `claude mcp add` writes `~/.claude.json`).
- The data (`.aify-graph/graph.sqlite` + briefs) lives **in the repo**, not in
  the plugin. The plugin is just code.
- The dashboard is `graph_dashboard()` (now in the default tool surface) — it
  serves the **cwd's** graph and returns `{url, port}`.

So a **user-scope registration already works in any repo**: launch the runtime
from a repo and the same server binds to that cwd. The friction is (a) it was
hard to discover the launch verb (fixed), and (b) one server = one repo at a time.

## The three scenarios + options

### 1. Per-project install (the default, works)
Register in the repo's `.mcp.json`. Pro: explicit, scoped. Con: re-register per
repo. **Recommendation:** keep as the documented default; it's the cleanest model.

### 2. Global / user-scope install
Register once at user scope; the server binds to whatever cwd the runtime starts
in. Pro: one registration, every repo. Con: still one `repoRoot` per process — no
cross-repo queries in a single session (see `known-limitations.md` "Multi-repo
live verbs require per-repo MCP registration").
**Recommendation:** document this as the "set-it-once" path. The real upgrade is
a `repoRoot` parameter on the verbs (or a repo-switcher), so one user-scope server
can answer for any indexed repo without relaunch — a bounded follow-up.

### 3. No project on disk (point an agent at a repo URL)
APG **cannot index a repo that isn't on disk** — tree-sitter and clangd read
files. So "install for `<url>`" must first **clone** it.
**Recommendation:** a small bootstrap flow / verb — `graph_bootstrap(url, dest?)`
— that clones (shallow) then runs the full build (`graph_index` + briefs +
functionality). Keeps the on-disk invariant while removing the manual clone step.

## Suggested next steps (bounded)
1. **Docs:** a short "Install scopes" section in `AGENTS.md` / README making
   project-vs-user scope and the on-disk requirement explicit. (low effort)
2. **`repoRoot` param** on the read verbs so a user-scope server can target any
   indexed repo — closes the multi-repo limitation. (medium)
3. **`graph_bootstrap(url)`** clone-then-index verb for the no-disk case. (medium)

None of these block today's workflow; they remove the rough edges the field
report surfaced. The dashboard launch itself is already a one-verb call now.
