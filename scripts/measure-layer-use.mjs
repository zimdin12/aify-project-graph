#!/usr/bin/env node
// Count one finished Claude Code run's uses of the trial's authored layer, from its transcript.
//
//   node scripts/measure-layer-use.mjs <session-id> --map-commit <sha> [--projects <dir>]
//
// The authored node ids are derived from `.aify-graph/functionality.json` at --map-commit with the import's own rule
// (scripts/lib/trial-layer-use.mjs), so the commit must be the one the import read. --projects defaults to
// ~/.claude/projects.
//
// Prints one JSON object: dashboardCalls, layerCalls (calls against authored nodes), seenCalls (of those, the ones
// whose nodes reached the agent), the nodes, and every call. Exit 0 counted, 1 refused (the run cannot be labelled),
// 2 bad arguments.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { authoredNodeIds, countLayerUse } from './lib/trial-layer-use.mjs';
import { readClaudeSession, DEFAULT_PROJECTS_DIR } from './lib/claude-session-files.mjs';

function parseArgs(argv) {
  const positional = [];
  let mapCommit;
  let projectsDir = DEFAULT_PROJECTS_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--map-commit' || argv[i] === '--projects') {
      if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value after it`);
      if (argv[i] === '--map-commit') mapCommit = argv[i + 1];
      else projectsDir = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 1 || !/^[0-9a-f]{7,40}$/u.test(mapCommit ?? '')) {
    throw new Error('usage: measure-layer-use.mjs <session-id> --map-commit <sha> [--projects <dir>]');
  }
  return { sessionId: positional[0], mapCommit, projectsDir };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const repo = new URL('..', import.meta.url);
  const map = JSON.parse(execFileSync('git', ['show', `${args.mapCommit}:.aify-graph/functionality.json`], { cwd: repo, encoding: 'utf8' }));
  const session = readClaudeSession(args.sessionId, { projectsDir: args.projectsDir });
  const outcome = session.ok
    ? countLayerUse({
      records: [...session.session, ...session.subagents.flat()],
      ids: authoredNodeIds(map),
      readPersisted: (path) => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    })
    : session;
  console.log(JSON.stringify(outcome, null, 1));
  return outcome.ok ? 0 : 1;
}

process.exit(main());
