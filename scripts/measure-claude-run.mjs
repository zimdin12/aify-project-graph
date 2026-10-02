#!/usr/bin/env node
// Measure one finished headless Claude Code run: its wall-clock time and its tokens, or the reason they cannot stand.
//
//   node scripts/measure-claude-run.mjs <stream.jsonl> <clock.json> [--projects <dir>]
//
// <stream.jsonl> is the run's stdout under `claude -p --output-format stream-json --verbose`.
// <clock.json> is {"startMs":…,"endMs":…}, taken by the launcher around the spawn.
// --projects defaults to ~/.claude/projects, where the harness writes the run's session files.
//
// Prints one JSON object. Exit 0 measured, 1 refused, 2 bad arguments. A refusal is a VOID run under the trial's
// protocol, not a run with smaller numbers. Definitions and the evidence behind them: scripts/lib/claude-run-record.mjs.
import { readFileSync } from 'node:fs';
import { measureRun } from './lib/claude-run-record.mjs';
import { parseJsonl, readClaudeSession, DEFAULT_PROJECTS_DIR } from './lib/claude-session-files.mjs';

function parseArgs(argv) {
  const positional = [];
  let projectsDir = DEFAULT_PROJECTS_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--projects') {
      if (argv[i + 1] === undefined) throw new Error('--projects needs a directory after it');
      projectsDir = argv[i + 1];
      i += 1;
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== 2) throw new Error('usage: measure-claude-run.mjs <stream.jsonl> <clock.json> [--projects <dir>]');
  return { streamFile: positional[0], clockFile: positional[1], projectsDir };
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const stream = parseJsonl(readFileSync(args.streamFile, 'utf8'), args.streamFile);
  if (!stream.ok) return report(stream);
  const sessionId = stream.records.find((r) => r?.session_id)?.session_id;
  const session = readClaudeSession(sessionId, { projectsDir: args.projectsDir });
  if (!session.ok) return report(session);
  const clock = JSON.parse(readFileSync(args.clockFile, 'utf8'));
  return report(measureRun({ stream: stream.records, clock, session }));
}

function report(outcome) {
  console.log(JSON.stringify(outcome, null, 1));
  return outcome.ok ? 0 : 1;
}

process.exit(main());
