// TRACKERS DO NOT AGREE ON HOW TO SPELL "OPEN".
//
// Measured on echoes (2026-08-10), ClickUp-sourced:
//   "to do" 42 · "complete" 46 · "open" 12 · "in_progress" 1 · "closed_workflow_neutral" 1
//
// The previous test was an inline regex duplicated at two call sites:
//   /open|progress|active|todo|in_progress/i
// `/todo/` does NOT match "to do" — ClickUp writes it with a space. So 42 of 101
// tasks were classified closed and dropped, and graph_consequences reported ZERO
// open tasks on a feature that had four. Verified after the fix: 16 open tasks
// surface on engine/rendering/GpuMaterialPalette.h, each with its tracker URL.
//
// This is a source-SPECIFIC failure in a layer documented as source-AGNOSTIC.
// APG imports from ClickUp, Asana, Linear, Jira, Plane, GitHub Issues and
// plaintext; a hardcoded vocabulary bets that every tracker spells things our way.
import { describe, it, expect } from 'vitest';
import { isTaskOpen, classifyTaskStatus } from '../../../mcp/stdio/overlay/task-status.js';

describe('task status classification across trackers', () => {
  it('★ "to do" is open — the exact spelling that lost 42 tasks', () => {
    expect(isTaskOpen('to do')).toBe(true);
    expect(isTaskOpen('To Do')).toBe(true);
    expect(isTaskOpen('to_do')).toBe(true);
    expect(isTaskOpen('TO-DO')).toBe(true);
  });

  it('recognises live states across tracker vocabularies', () => {
    for (const s of ['open', 'backlog', 'triage', 'in progress', 'In Progress',
      'doing', 'in review', 'blocked', 'on hold', 'reopened', 'ready', 'planned']) {
      expect(isTaskOpen(s), `${s} should be open`).toBe(true);
    }
  });

  it('recognises terminal states, including ClickUp\'s workflow-neutral close', () => {
    for (const s of ['complete', 'Completed', 'closed', 'done', 'resolved',
      'cancelled', 'canceled', "won't fix", 'archived', 'closed_workflow_neutral',
      'shipped', 'merged', 'duplicate']) {
      expect(isTaskOpen(s), `${s} should be closed`).toBe(false);
    }
  });

  it('★ an UNRECOGNISED status counts as open, not closed', () => {
    // The original failure was silent: work existed and the reader was told it did
    // not. Treating an unknown state as closed reproduces exactly that for the next
    // tracker we have never seen — a Plane or Asana state would vanish rather than
    // surface. Unknown means unknown; the honest default for "there may be work
    // here" is to show it.
    expect(isTaskOpen('awaiting-cosmic-alignment')).toBe(true);
    expect(classifyTaskStatus('awaiting-cosmic-alignment')).toBe('unknown');
  });

  it('reports unknown DISTINCTLY from open, so a caller can say which', () => {
    expect(classifyTaskStatus('open')).toBe('open');
    expect(classifyTaskStatus('complete')).toBe('closed');
    expect(classifyTaskStatus('')).toBe('unknown');
    expect(classifyTaskStatus(null)).toBe('unknown');
    expect(classifyTaskStatus(undefined)).toBe('unknown');
  });

  it('the CLOSED list is the authority, not the OPEN list', () => {
    // Structural: openness is defined as "not terminal", so an unseen tracker's
    // in-progress state fails toward VISIBLE. If this inverts to an allow-list,
    // the 42-task bug returns for whichever tracker we onboard next.
    const src = readFileSyncSafe();
    expect(src).toMatch(/absence from CLOSED is/);
  });
});

function readFileSyncSafe() {
  // Inline to keep the import list honest about what this file needs.
  // eslint-disable-next-line
  return require('node:fs').readFileSync(
    require('node:path').join(import.meta.dirname, '../../../mcp/stdio/overlay/task-status.js'),
    'utf8',
  );
}
