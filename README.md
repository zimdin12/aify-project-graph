# aify-project-graph

On-demand codebase graph map for coding agents (Claude Code, Codex).

Tree-sitter scans your project, builds a structural graph in SQLite, and exposes high-intent query verbs over MCP. Agents navigate code, trace execution paths, and assess impact — using compact responses instead of reading files.

## What it does

- **Scans any project** — 10 languages out of the box (Python, JS, TS, PHP, C, C++, Go, Rust, Ruby, Java)
- **Maps everything** — code symbols + directories, docs, configs, routes, entry points, schemas
- **Stays fresh** — git-diff-aware incremental updates on every query
- **Speaks agent** — compact NODE/EDGE/PATH line format, hard token budget, file:line citations
- **Framework-aware** — plugin system with Laravel routes in v1

## Quick start

```bash
npm install
# Register as MCP server (see install.claude.md / install.codex.md)
# Then in your agent:
graph_report()      # orient in the project
graph_whereis(symbol="User")   # find where User is defined
graph_path(from="handleRequest")   # trace the execution path
graph_impact(symbol="User")    # what breaks if I change User?
```

## Install

- **Claude Code:** [install.claude.md](install.claude.md)
- **Codex:** [install.codex.md](install.codex.md)
- **OpenCode:** [install.opencode.md](install.opencode.md)

## Design

- **Spec:** [docs/superpowers/specs/2026-04-16-aify-project-graph-design.md](docs/superpowers/specs/2026-04-16-aify-project-graph-design.md)
- **Query format:** [docs/query-format.md](docs/query-format.md) (coming soon)

## The `.aify-graph/graph.sqlite` file

This is the product. Like `.git/` is the product of `git init`, `.aify-graph/` is the product of `graph_index()`. One SQLite file per project. No server, no container, no cloud.

## License

MIT. See [LICENSE](LICENSE).

Patterns adapted from [graphify](https://github.com/safishamsi/graphify) (MIT). See [ATTRIBUTION.md](ATTRIBUTION.md).
