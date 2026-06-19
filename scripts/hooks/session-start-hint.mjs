#!/usr/bin/env node
// SessionStart hook — discoverability nudge for MANAGED agent sessions.
//
// Problem (Sand Castle usage report, P0 #1): in managed Claude/Codex sessions
// the MCP tools are deferred behind a search step, so an agent that doesn't
// already know aify-project-graph exists never loads its verbs and goes straight
// to grep — zero usage. The MCP server's own `instructions` carry a ToolSearch
// nudge (always-on), and THIS hook is the belt-and-suspenders: it fires at
// session start, before any tool call, when the cwd is an APG-indexed repo.
//
// Wire it into the host's settings (Claude Code example):
//   "hooks": { "SessionStart": [ { "hooks": [ { "type": "command",
//     "command": "node /path/to/aify-project-graph/scripts/hooks/session-start-hint.mjs" } ] } ] }
//
// Silent (exit 0, no output) when the cwd is NOT an APG repo, so it's safe to
// install globally.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!existsSync(join(cwd, '.aify-graph'))) process.exit(0); // not an APG repo — stay quiet

const hint = 'aify-project-graph is available for this repo (.aify-graph/ present). '
  + 'If you do not see graph_* / code_intel_* tools, run ToolSearch "graph" to load them, '
  + 'then ORIENT with graph_packet / graph_pull before grepping. '
  + 'Read .aify-graph/brief.agent.md first — it is the fastest cross-layer map.';

// Claude Code injects hookSpecificOutput.additionalContext from SessionStart
// hooks into the session; plain stdout is also surfaced for hosts that don't
// parse the JSON envelope.
process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: hint },
}));
