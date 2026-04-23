import { describe, expect, it } from 'vitest';
import { summarizeOverlayQuality, taskLinkStrength } from '../../../mcp/stdio/overlay/quality.js';

describe('overlay/quality task linkage', () => {
  it('classifies task link strength from explicit fields and evidence prefixes', () => {
    expect(taskLinkStrength({ features: ['auth'], link_strength: 'broad', evidence: 'path:src/auth.js' })).toBe('broad');
    expect(taskLinkStrength({ features: ['auth'], evidence: 'path:src/auth.js' })).toBe('strong');
    expect(taskLinkStrength({ features: ['auth'], evidence: 'title:auth cleanup work' })).toBe('broad');
    expect(taskLinkStrength({ features: ['auth'], evidence: 'manual match plus docs read' })).toBe('mixed');
    expect(taskLinkStrength({ features: [] })).toBe('unlinked');
  });

  it('summarizes linked task strength counts', () => {
    const summary = summarizeOverlayQuality(
      [{ id: 'auth', anchors: {}, tests: ['tests/a'], depends_on: ['core'], related_to: ['sessions'] }],
      [
        { id: 'T-1', features: ['auth'], evidence: 'path:src/auth.js' },
        { id: 'T-2', features: ['auth'], evidence: 'title:future auth polish' },
        { id: 'T-3', features: ['auth'], evidence: 'manual match after docs review' },
        { id: 'T-4', features: [] },
      ],
    );

    expect(summary).toMatchObject({
      featureCount: 1,
      tasksTotal: 4,
      linkedTasks: 3,
      strongTaskLinks: 1,
      mixedTaskLinks: 1,
      broadTaskLinks: 1,
      unlinkedTasks: 1,
    });
  });
});
