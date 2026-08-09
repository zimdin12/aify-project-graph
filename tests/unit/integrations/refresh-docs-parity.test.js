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
