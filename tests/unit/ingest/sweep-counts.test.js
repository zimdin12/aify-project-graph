// ⛔ EVERY CLASSIFICATION THE SWEEP DECLINED WAS INVISIBLE.
//
// `sweepFilesystem` visits every candidate file, decides per file that this `.md` is not a
// Document (or this `.json` not a Config, or this file not anything), and dropped the decision on
// the floor: four bare `continue`s and a `return { nodes, edges }` with nowhere to record them.
//
// ef-manager measured the Document hole from OUTSIDE, with `git ls-files` — 52.7% of this repo's
// markdown is not a node, against 1.4% on sand_castle — because there was no number inside to
// read. Their generalisation is the reason this test exists rather than a doc-specific one: if
// Route, Schema, Config or Entrypoint are under-admitting the same way, no figure would show it
// and the first evidence would again arrive from someone measuring us from the outside.
//
// ⚠ `seen` IS PUBLISHED AS THE INPUT, at their request: "publish the input, and the outcomes sum
// to it or the sum is itself a finding." A reader reconciling their own file count against ours
// otherwise finds a discrepancy with nowhere to attribute it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweepFilesystem } from '../../../mcp/stdio/ingest/sweep.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

async function fixture() {
  repo = await mkdtemp(join(tmpdir(), 'apg-sweepcount-'));
  await mkdir(join(repo, 'docs'), { recursive: true });
  await mkdir(join(repo, 'skills', 'thing'), { recursive: true });
  await writeFile(join(repo, 'README.md'), '# readme\n');            // admitted: name rule
  await writeFile(join(repo, 'docs', 'design.md'), '# design\n');    // admitted: docs/ dir rule
  await writeFile(join(repo, 'skills', 'thing', 'SKILL.md'), '# s\n'); // DECLINED — the real hole
  await writeFile(join(repo, 'install.claude.md'), '# i\n');          // DECLINED — the real hole
  await writeFile(join(repo, 'package.json'), '{}\n');               // admitted: Config
  await writeFile(join(repo, 'src.txt'), 'x\n');                     // DECLINED
  return repo;
}

const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);

describe('the sweep publishes what it declined, not only what it admitted', () => {
  it('★★★ the outcomes RECONCILE against the input, or the sum is itself a finding', async () => {
    // The load-bearing assertion. Counts that do not add up to the candidate set mean an outcome
    // exists that nobody is recording — which is the state this whole change is fixing, and it
    // would otherwise be invisible again the moment a new `continue` is added.
    await fixture();
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts.seen, 'the sweep must state its own denominator').toBeGreaterThan(0);
    expect(total(counts.admitted) + total(counts.declined), 'every candidate has exactly one outcome')
      .toBe(counts.seen);
  }, 30_000);

  it('★★★ a markdown file that is not a Document is COUNTED as declined', async () => {
    // The 52.7% made visible from inside. `SKILL.md` and `install.claude.md` fail all three
    // clauses of isDocument — not a readme, not in the 12-word list, not under a "doc" directory.
    // The rule is unchanged here; what changes is that its output is now a number.
    await fixture();
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts.admitted.Document, 'README.md and docs/design.md').toBe(2);
    expect(counts.declined.text_not_admitted_as_document, 'SKILL.md, install.claude.md, src.txt')
      .toBe(3);
    // ⚠ THE SPLIT IS THE POINT. A single bucket measured 649 on the real repo, most of them .js
    // files the sweep is SUPPOSED to decline because the main extractor owns them. An expected
    // outcome and a real hole under one name is unreadable, and it would have buried the number
    // that matters under four times its own volume.
    expect(counts.declined.not_a_special_kind, 'package.json is admitted, so nothing here')
      .toBe(0);
  }, 30_000);

  it('★★★ counts are published even when NOTHING was declined', async () => {
    // ⚠ A field that appears only when something is wrong cannot be told apart from a build that
    // never had the check — the inference a field user correctly drew from a missing
    // `staleProcess` key on 2026-08-07. An always-present zero is what makes a non-zero readable.
    repo = await mkdtemp(join(tmpdir(), 'apg-sweepclean-'));
    await writeFile(join(repo, 'README.md'), '# only an admitted file\n');
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts, 'the shape exists regardless of outcome').toBeTruthy();
    expect(counts.declined.text_not_admitted_as_document).toBe(0);
    expect(counts.declined.not_a_special_kind).toBe(0);
    expect(counts.declined.over_size_cap).toBe(0);
    expect(counts.admitted.Document).toBe(1);
  }, 30_000);

  it('★★★ the size cap is counted even though it is not currently firing anywhere', async () => {
    // ef-manager checked: 0 files over 500KB across APG, echoes and sand_castle, largest markdown
    // 181,537 B. Counted anyway because the cap sits UPSTREAM of every classifier — a file
    // dropped there is invisible even to a fix that counts classifier rejections, and
    // sand_castle's largest document is within 3x of it.
    repo = await mkdtemp(join(tmpdir(), 'apg-sweepbig-'));
    await mkdir(join(repo, 'docs'), { recursive: true });
    await writeFile(join(repo, 'docs', 'huge.md'), 'x'.repeat(600_000));
    await writeFile(join(repo, 'README.md'), '# ok\n');
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts.declined.over_size_cap, 'a silent upstream drop is now a number').toBe(1);
    expect(total(counts.admitted) + total(counts.declined)).toBe(counts.seen);
  }, 30_000);
});
