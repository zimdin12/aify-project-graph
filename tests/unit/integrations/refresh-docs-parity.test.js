// The installer existed since before v0.3.0 and nothing told anyone to run it.
// Two repos reached 20 and 130 commits stale with the fix sitting unused in the
// same tree. A mechanism nobody is told about is equivalent to one that does not
// exist, so the docs naming it are part of the mechanism.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AIFY_HOOKS } from '../../../scripts/install-graph-hook.mjs';

const REPO = join(import.meta.dirname, '..', '..', '..');
const DOCS = ['README.md', 'install.hermes.md', 'install.codex.md', 'install.cursor.md', 'install.opencode.md'];

describe('refresh hooks are documented as setup', () => {
  for (const doc of DOCS) {
    it(`${doc} tells the reader to install the refresh hooks`, () => {
      const text = readFileSync(join(REPO, doc), 'utf8');
      expect(text, `${doc} names the installer`).toMatch(/install-graph-hook\.mjs/);
    });
  }

  it('the docs state hooks are per-clone and not carried by git clone', () => {
    // The single most likely wrong assumption: that cloning brings the hooks.
    const text = readFileSync(join(REPO, 'README.md'), 'utf8');
    expect(text).toMatch(/not (carried|copied) by .?git clone|per-clone|per-machine/i);
  });

  it('server-instructions names the refresh mechanism in its FRESHNESS section', () => {
    const text = readFileSync(join(REPO, 'mcp', 'stdio', 'server-instructions.js'), 'utf8');
    expect(text).toMatch(/refreshMechanism/);
  });

  it('no doc claims a hook count that disagrees with AIFY_HOOKS', () => {
    // Same drift class as the verb counts: a hand-written number restated in
    // five files, wrong in three of them.
    for (const doc of DOCS) {
      const text = readFileSync(join(REPO, doc), 'utf8');
      const m = text.match(/(\d+) (?:git )?refresh hooks/);
      if (m) expect(Number(m[1]), `${doc} hook count`).toBe(AIFY_HOOKS.length);
    }
  });
});

describe('the SKILLS carry what the server reports', () => {
  // v0.5.0 shipped `refreshMechanism` and updated server-instructions.js and the
  // install docs — and NOT the skills, which still told agents APG_AUTO_REINDEX
  // was the remedy. Two agent-facing surfaces, one updated. The skills are what
  // an agent actually loads at session start, so a field the server reports and
  // no skill explains is a field nobody reads.
  const RUNTIMES = ['claude-code', 'codex', 'cursor', 'hermes'];

  it('★ every runtime skill tree explains refreshMechanism', () => {
    for (const rt of RUNTIMES) {
      const root = readFileSync(join(REPO, 'integrations', rt, 'skill', 'SKILL.md'), 'utf8');
      const guide = readFileSync(join(REPO, 'integrations', rt, 'skills', 'graph-guide', 'SKILL.md'), 'utf8');
      expect(root, `${rt} session-start skill`).toMatch(/refreshMechanism/);
      expect(guide, `${rt} graph-guide`).toMatch(/refreshMechanism/);
    }
  });

  it('no skill still presents APG_AUTO_REINDEX as the primary remedy', () => {
    // It is the fallback now — it refreshes on the read path, so you wait for it.
    // Naming it as the fix, with no mention of the hooks, is what was there before.
    for (const rt of RUNTIMES) {
      const root = readFileSync(join(REPO, 'integrations', rt, 'skill', 'SKILL.md'), 'utf8');
      if (!/APG_AUTO_REINDEX/.test(root)) continue;
      expect(root, `${rt} names the hooks alongside it`).toMatch(/install-graph-hook|refresh hook/);
    }
  });
});
