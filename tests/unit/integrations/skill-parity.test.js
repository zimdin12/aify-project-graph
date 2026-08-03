// We ship the SAME skills to four runtimes (claude-code / codex / cursor /
// hermes) as four physical copies. Nothing verified they stayed in sync, and
// they didn't: the 2026-07-11 polish pass found `''` quote-escape corruption
// baked into rendered prose in 3 of the 4 trees, plus CRLF line endings in 6
// files that made every drift check report whole-file differences on identical
// content (hiding the real drift underneath).
//
// These are cheap structural guards so a hand-edit to one tree can't silently
// ship three stale copies. Frontmatter is allowed to differ per runtime
// (quoting style, runtime-specific fields); the BODY is the contract.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const INTEGRATIONS = join(REPO_ROOT, 'integrations');
const RUNTIMES = ['claude-code', 'codex', 'cursor', 'hermes'];
// claude-code is the source of truth — it is the tree we author in.
const CANONICAL = 'claude-code';

function readNormalized(path) {
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

// Strip YAML frontmatter; the body is what must match across runtimes.
function bodyOf(text) {
  const m = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(text);
  return (m ? m[1] : text).trim();
}

function skillNames() {
  return readdirSync(join(INTEGRATIONS, CANONICAL, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function allShippedMarkdown() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) out.push(p);
    }
  };
  walk(INTEGRATIONS);
  return out;
}

describe('shipped integration skills', () => {
  it('every runtime ships the same set of skills', () => {
    const canonical = skillNames().sort();
    for (const rt of RUNTIMES) {
      const names = readdirSync(join(INTEGRATIONS, rt, 'skills'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      expect(names, `runtime ${rt} skill set`).toEqual(canonical);
    }
  });

  it('skill BODIES are identical across runtimes (frontmatter may differ)', () => {
    for (const name of skillNames()) {
      const canonicalBody = bodyOf(readNormalized(join(INTEGRATIONS, CANONICAL, 'skills', name, 'SKILL.md')));
      for (const rt of RUNTIMES) {
        if (rt === CANONICAL) continue;
        const file = join(INTEGRATIONS, rt, 'skills', name, 'SKILL.md');
        expect(existsSync(file), `${rt}/${name} exists`).toBe(true);
        expect(bodyOf(readNormalized(file)), `${rt}/skills/${name}/SKILL.md body vs ${CANONICAL}`)
          .toBe(canonicalBody);
      }
    }
  });

  it('the main skill BODY is identical across runtimes', () => {
    const canonicalBody = bodyOf(readNormalized(join(INTEGRATIONS, CANONICAL, 'skill', 'SKILL.md')));
    for (const rt of RUNTIMES) {
      if (rt === CANONICAL) continue;
      expect(bodyOf(readNormalized(join(INTEGRATIONS, rt, 'skill', 'SKILL.md'))), `${rt} main skill body`)
        .toBe(canonicalBody);
    }
  });

  // The actual 2026-07-11 defect: a quoting escape leaked into rendered prose,
  // so agents read `it''s` / `can''t` in three of the four trees.
  it('no doubled-apostrophe quote-escape corruption leaks into shipped prose', () => {
    const offenders = allShippedMarkdown()
      .filter((f) => readFileSync(f, 'utf8').includes("''"))
      .map((f) => f.replace(REPO_ROOT, ''));
    expect(offenders, 'files containing "\'\'"').toEqual([]);
  });

  // CRLF made drift checks report false whole-file differences, and these trees
  // get copied verbatim into Linux/WSL runtimes.
  it('shipped markdown uses LF line endings', () => {
    const offenders = allShippedMarkdown()
      .filter((f) => readFileSync(f, 'utf8').includes('\r\n'))
      .map((f) => f.replace(REPO_ROOT, ''));
    expect(offenders, 'files containing CRLF').toEqual([]);
  });

  // The checks above compare `skills/<name>/SKILL.md` across trees, so they
  // only see files that exist in the canonical tree. A file present ONLY in a
  // downstream tree was invisible to all of them: `skill/references/SKILL-full.md`
  // sat in codex/cursor/hermes for months — a full stale copy of the
  // session-start skill, outside `skills/` so the set check missed it, and
  // unreferenced so nothing forced it to be updated. It still carried verb
  // counts that had since changed. Anything sync does not own must not exist.
  it('no runtime ships a markdown file the canonical tree lacks', () => {
    const rel = (p) => p.slice(INTEGRATIONS.length + 1).replace(/\\/g, '/');
    const orphans = [];
    for (const path of allShippedMarkdown()) {
      const r = rel(path);
      const slash = r.indexOf('/');
      const rt = r.slice(0, slash);
      if (rt === CANONICAL || !RUNTIMES.includes(rt)) continue;
      const counterpart = join(INTEGRATIONS, CANONICAL, r.slice(slash + 1));
      if (!existsSync(counterpart)) orphans.push(r);
    }
    expect(orphans, 'files in a runtime tree with no canonical counterpart').toEqual([]);
  });

  it('every skill has non-empty name + description frontmatter', () => {
    for (const rt of RUNTIMES) {
      for (const name of skillNames()) {
        const text = readNormalized(join(INTEGRATIONS, rt, 'skills', name, 'SKILL.md'));
        const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
        expect(fm, `${rt}/${name} has frontmatter`).not.toBeNull();
        expect(fm[1], `${rt}/${name} frontmatter name`).toMatch(/^name:\s*\S+/m);
        expect(fm[1], `${rt}/${name} frontmatter description`).toMatch(/^description:\s*\S+/m);
      }
    }
  });
});
