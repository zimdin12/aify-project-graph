// AN INSTALLED SKILL IS A COPY, AND COPIES DO NOT LEARN.
//
// graph-senior-dev, 2026-08-19: `skill_view('cpp-inner-loop')` in their live profile still
// served the WITHDRAWN contract — that `evidence.exhaustive === true` is the safe basis for a
// dead-code claim — because skills ship by copying this tree and an installed copy never
// updates when the server does. They patched their own profile; every other existing install
// still holds it.
//
// ✅ SCOPED BY WHAT A STALE COPY CAN ACTUALLY DO, checked rather than assumed: the withdrawn
// advice was CONDITIONAL on a flag that is now never issued (verified — the best case returns
// exhaustive:false / index_population_unattested, and the zero-caller deletion shape returns
// definition_only). So a stale copy costs a wasted expectation, never a bad deletion, because
// the runtime refuses underneath it. That is why this is a detectable MARKER plus a re-copy
// note rather than a mechanism billed to every session: the always-paid tier is for doubt the
// reader must act on, and this is not that.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INTEGRATIONS = fileURLToPath(new URL('../../../integrations/', import.meta.url));
const MARKER = 'APG-SAFETY-CONTRACT: 2026-08-19-exhaustive-withheld';
const RUNTIMES = readdirSync(INTEGRATIONS, { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name);

describe('the C++ skill carries a detectable safety-contract revision', () => {
  it('★★★ every shipped runtime copy is stamped with the current revision', () => {
    // Derived from the directory listing, not a hand-written list of four names — a fifth
    // runtime must not be able to ship unstamped just because nobody edited this test.
    const missing = RUNTIMES.filter((r) => {
      const p = join(INTEGRATIONS, r, 'skills', 'cpp-inner-loop', 'SKILL.md');
      try { return !readFileSync(p, 'utf8').includes(MARKER); } catch { return false; }
    });
    expect(missing, 'an unstamped copy cannot be recognised as stale by its reader').toEqual([]);
  });

  it('★★★ the install guide explains how to detect and replace a stale copy', () => {
    const guide = readFileSync(fileURLToPath(new URL('../../../install.claude.md', import.meta.url)), 'utf8');
    expect(guide, 'the marker must appear where someone looks to update').toContain('APG-SAFETY-CONTRACT');
    expect(guide).toMatch(/re-run Step 3|re-copy/i);
  });

  it('★★★ no shipped copy still states the withdrawn claim as current', () => {
    // The claim itself, not its phrasing: any copy asserting that exhaustive===true licenses a
    // dead-code conclusion, without the withdrawal beside it, is serving retired authority.
    for (const r of RUNTIMES) {
      const p = join(INTEGRATIONS, r, 'skills', 'cpp-inner-loop', 'SKILL.md');
      let text;
      try { text = readFileSync(p, 'utf8'); } catch { continue; }
      if (!/only trust an empty refs list/i.test(text)) continue;
      expect(text, `${r} still presents the withdrawn gate without its withdrawal`)
        .toMatch(/withheld|withdrawn|NOT CURRENTLY REACHABLE/i);
    }
  });
});
