#!/usr/bin/env node
// CLI: generate brief.md / brief.agent.md / brief.json for a repo whose
// graph is already built. Intended for index-time hook and manual runs.
import { resolve } from 'node:path';
import { generateBrief } from '../mcp/stdio/brief/generator.js';

const [, , repoRootArg] = process.argv;
if (!repoRootArg) {
  console.error('usage: graph-brief.mjs <repoRoot>');
  process.exit(2);
}
const repoRoot = resolve(repoRootArg);
const stats = generateBrief({ repoRoot });
console.log(`brief.md         ${stats.md_bytes}B (~${stats.md_tokens_est} tok)`);
console.log(`brief.agent.md   ${stats.agent_bytes}B (~${stats.agent_tokens_est} tok)`);
console.log(`brief.onboard.md ${stats.onboard_bytes}B (~${stats.onboard_tokens_est} tok)`);
console.log(`brief.plan.md    ${stats.plan_bytes}B (~${stats.plan_tokens_est} tok)`);
console.log(`brief.json       ${stats.json_bytes}B`);
console.log(`wrote to ${repoRoot}/.aify-graph/`);
