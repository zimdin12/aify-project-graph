// A WARNING WHOSE READER CANNOT ACT ON IT IS HALF A WARNING.
//
// Two failures from the same string, both found by ef-manager (2026-08-09/10) by
// being blocked by it twice in two sessions:
//
// 1. It said "RESTART the aify-project-graph MCP server." Correct for an operator,
//    impossible for an agent — the host spawns the server at session start, and
//    killing it drops the connection rather than reloading. The agent is the one
//    who reads the string and the one who cannot perform it.
//
// 2. I told them to verify the restart by checking `server.commit`. That field
//    CANNOT answer "did a restart occur" — after a failed restart it reads exactly
//    the same as after a successful restart onto the same code. Their startedAt
//    held at 15:37:34.353Z across seven hours, three commits and a restart attempt,
//    which is what actually proved the process never cycled.
//
// The second is the sharper one: it is the wrong-referent pattern again — a true
// check bound to a question it cannot answer.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(
  join(import.meta.dirname, '..', '..', '..', 'mcp', 'stdio', 'server-build.js'),
  'utf8',
);

describe('the stale warning is actionable by whoever reads it', () => {
  it('★ says an agent cannot self-restart, and names who can', () => {
    expect(src).toMatch(/an agent cannot self-restart/);
    expect(src).toMatch(/ask your operator/);
  });

  it('★ warns that a session restart may not respawn the MCP child', () => {
    // The failure mode that cost two rounds: comms_restart cycled the worker and
    // left the MCP child serving code from first launch.
    expect(src).toMatch(/cycle the agent worker WITHOUT respawning/);
  });

  it('★ surfaces PROCESS STARTED as the restart discriminator', () => {
    expect(src).toMatch(/PROCESS STARTED/);
    expect(src).toMatch(/timestamp is unchanged, the restart did not reach/);
  });

  it('★ says explicitly that commit alone cannot answer it', () => {
    // Without this the next reader repeats the loop: retry the restart, re-read
    // the same hash, conclude nothing.
    expect(src).toMatch(/indistinguishable by commit alone/);
  });
});
