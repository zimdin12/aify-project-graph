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

// Loud anchor validation: print ONLY when something is broken. Healthy
// overlays (or no overlay at all) stay silent to keep output terse.
if (stats.anchorValidation && stats.anchorValidation.brokenFeatures > 0) {
  const { checkedFeatures, brokenFeatures, sample } = stats.anchorValidation;
  console.log('');
  console.log(`⚠ anchor validation: ${brokenFeatures}/${checkedFeatures} features have broken anchors`);
  for (const s of sample) {
    const misses = [...s.missingSymbols, ...s.missingFiles].slice(0, 3).join(', ');
    console.log(`  - ${s.feature}: ${s.resolved}/${s.declared} anchors resolved${misses ? ` (missing: ${misses})` : ''}`);
  }
  console.log('  → edit .aify-graph/functionality.json or run /graph-anchor-drift');
} else if (stats.anchorValidation && stats.anchorValidation.checkedFeatures > 0) {
  console.log(`✓ anchors: ${stats.anchorValidation.checkedFeatures} features, all resolved`);
}
