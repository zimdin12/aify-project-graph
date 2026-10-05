# Hermes probes for the rehearsal, 2026-10-05

Hermes v0.21.5, gpt-6.1-sol at medium reasoning. The readers are read-only. Run them from the repo root, so that
`better-sqlite3` resolves:
`node docs/evidence/rehearsal-2026-10-05/hermes-probes/hermes-msgs.mjs <state.db> <session>`.

A profile run writes to `%LOCALAPPDATA%/hermes/profiles/<name>/state.db`. A default-profile run writes to
`%LOCALAPPDATA%/hermes/state.db`.

## 1. Arm profile login (`rha`, created with `--no-skills --no-alias`)
One-shot `-p rha -z "Reply with the single word ok."` answered `ok` in 28 s, session 20261005_072658_32005c.
- `rha-login-usage.json` is the `--usage-file` report.
- `rha-login-rows.txt` holds the profile's session_model_usage rows.
- The two agree on every field: main 11130 in / 5 out, title_generation 236 in / 45 out.

## 2. APG was not loading in any Hermes session (found in the rehearsal)
`mcp-test-before.txt` is `hermes mcp test aify-project-graph`, exit 1. Hermes runs MCP servers on its own bundled Node
26.7.0 (NODE_MODULE_VERSION 147). Its config launched APG with `command: node` from this checkout, whose better-sqlite3 is
built for Node 22.20.0 (127), the Node Claude Code uses.

Hermes treats the mismatch as permanent and parks the server without retrying. APG's native-module preflight, which
AGENTS.md says self-heals this, never gets to run.

**Extent.** 240 NodeAbiMismatch lines for this server across `agent.log.1`, `agent.log` and `errors.log`. The first is
at 2026-10-04 20:33:50, the start of the oldest log that survives. "Since" that time is unknown; "at least since" holds.

**Not done:** the `npm rebuild` under Hermes' Node that Hermes' error text recommends. It rebuilds the one shared binary
for ABI 147 and breaks Claude Code's APG on the same checkout.

**Fix:** the config now launches APG with `command: C:/nvm4w/nodejs/node.exe`, so both runtimes load the binary on the
same ABI. The backup is `config.yaml.bak-apg-node-abi-20261005`, and the diff against it is that one line.
`mcp-test-after.txt` shows exit 0: connected, 16 tools. It was first proven on a throwaway profile, since deleted.

## 3. The arm profile has no APG, proven from inside a run, with a control
The same prompt went to both profiles: call `hermes_tool_search` once with `graph`. The readers count APG names in the
TOOL RESULT rows of state.db, which is the harness's record, not the model's reply.

| file | profile | deferred tools available | APG names in tool results |
|---|---|---|---|
| `tool-search-rha.txt` | rha | 4 | 0 (`matches: []`) |
| `tool-search-default.txt` | default (APG configured) | 56 | 19 |

**An instrument that failed its control, and is retired.** Asking the model to list its tools showed zero APG names in the
default profile too, after the fix. Hermes defers MCP tools behind `hermes_tool_search` (56 deferred here), so a
self-listed tool list cannot see them. An earlier listing, before the fix, showed 34 aify-comms tools inline. That fits
deferral starting above some tool count, but this does NOT establish the threshold.
