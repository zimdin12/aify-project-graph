// A SHARED ARTIFACT THAT DOES NOT SELF-DATE ROTS SILENTLY.
//
// The briefs are the nearest thing this tool has to shared TEAM understanding of a
// codebase. On a real repo they sat 96 days stale while four agents worked around
// them, and the staleness was visible ONLY in graph_health — a verb none of them
// called (ef-manager, 2026-07-30). A brief read straight off disk looked
// authoritative and was three months out of date.
//
// His framing is the one that matters: shared artifacts that don't self-date rot
// silently, and a team rots with them. The fix is not a better warning somewhere
// else — it is that the artifact carries its own age.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { generateBrief } from '../../../mcp/stdio/brief/generator.js';

const BRIEFS = ['brief.agent.md', 'brief.onboard.md', 'brief.plan.md'];

describe('briefs state their own age', () => {
  let repoRoot;

  async function build(indexedAt) {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-age-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ('f1','File','a.js','src/a.js',1,1,'javascript',1,'{}')`);
    db.close();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit: 'abc1234', indexedAt, schemaVersion: 4, dirtyEdgeCount: 0,
    }));
    generateBrief({ repoRoot });
  }

  afterEach(async () => { try { await rm(repoRoot, { recursive: true, force: true }); } catch {} });

  it('every brief carries a GENERATED line', async () => {
    await build(new Date().toISOString());
    for (const f of BRIEFS) {
      const text = readFileSync(join(repoRoot, '.aify-graph', f), 'utf8');
      expect(text, `${f} has no age line`).toMatch(/^GENERATED: \d{4}-\d{2}-\d{2}/m);
    }
  });

  it('the age line is FIRST — a reader who stops after one line still learns it', async () => {
    await build(new Date().toISOString());
    const text = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^GENERATED:/);
  });

  it('an old brief says STALE in its own first line, not only in graph_health', async () => {
    // The 96-day case. This is the whole point: the artifact must not need a verb
    // call to reveal that it is out of date.
    const old = new Date(Date.now() - 96 * 86400000).toISOString();
    await build(old);
    const text = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
    expect(text).toMatch(/96d ago/);
    expect(text).toMatch(/STALE, regenerate before trusting feature\/task claims/);
  });

  it('a fresh brief does NOT cry stale — the warning has to stay meaningful', async () => {
    await build(new Date().toISOString());
    const text = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
    expect(text).toMatch(/\(today\)/);
    expect(text).not.toMatch(/STALE/);
  });

  it('a missing or unparseable indexedAt emits no line rather than a wrong one', async () => {
    // Claiming an age we cannot compute would be worse than saying nothing.
    await build(undefined);
    const text = readFileSync(join(repoRoot, '.aify-graph', 'brief.agent.md'), 'utf8');
    expect(text).not.toMatch(/GENERATED:/);
    expect(text).toMatch(/^REPO:/m);
  });
});
