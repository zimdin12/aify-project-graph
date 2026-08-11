// AMBIGUOUS IS NOT UNMAPPED, AND SAYING SO WAS A LIE ABOUT A LOOKUP THAT NEVER RAN.
//
// The ambiguous path short-circuits the symbol→feature lookup. It used to print
// "ambiguous / no feature mapping", which reads as "we checked and there is none" —
// while nothing had been attempted. Measured on echoes: `GpuMaterial` and
// `material-palette` were both reported as mapping to no feature, and both map to one.
//
// Worse than the timeout case in one respect: there a lookup ran and failed. Here none
// ran, and the output could not distinguish "we looked and found none" from "ambiguity
// stopped us before we looked". And by the cost analysis this is the CHEAP path — the one
// large C++ repos land on most often.
//
// ★★ CONVERTED FROM SOURCE-GREP 2026-08-11.
//
// The previous version asserted regexes over packet.js. Mutation showed it was UNTESTED
// rather than cleared: removing the STATUS emission turned 1 of 3 cases red, and the
// other two were never reached by that mutation — one is a `.not.toMatch` negative guard
// that no emission change can fail, the other asserts a different line entirely.
//
// ⚠ The negative guard is the important one and it is the reason this file exists: the
// defect was a WRONG SENTENCE, so the test that matters is "the old claim is not made".
// A source regex can assert that about the FILE; only running the code can assert it
// about the OUTPUT — and the output is what a reader sees.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphPacket } from '../../../mcp/stdio/query/verbs/packet.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;

beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-ambiguous-'));
  await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 0, edges: 0,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));

  // Two definitions of one name in different files → ambiguous by construction.
  // This is the echoes shape: a type mirrored across translation units.
  const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
  for (const [id, file] of [['a', 'src/one.cpp'], ['b', 'src/two.cpp'], ['c', 'src/three.cpp']]) {
    db.run(
      `INSERT INTO nodes (id, type, label, file_path, start_line, end_line, language, confidence, extra)
       VALUES ($id, 'Class', 'GpuMaterial', $file, 10, 20, 'cpp', 1, '{}')`,
      { id, file },
    );
  }
  db.close();
});

afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* windows lock */ } }
});

const asText = (o) => (typeof o === 'string' ? o : JSON.stringify(o));

describe('the ambiguous path does not claim a feature mapping it never checked', () => {
  it('★★ NEVER emits the old "no feature mapping" claim — asserted on OUTPUT, not source', async () => {
    // The whole defect, as a property of what a reader receives. The source-grep version
    // could only say the phrase is absent from packet.js; a phrase can be absent from one
    // file and assembled in another.
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    expect(text, 'harness sanity: the fixture must reach the ambiguous path').toMatch(/AMBIGUOUS/);
    expect(text, 'the false claim must not appear in any form').not.toMatch(/no feature mapping/i);
    expect(text).not.toMatch(/maps to no feature\b(?!\.)/);
  });

  it('★ says the lookup was NOT CHECKED and that this is not "unmapped"', async () => {
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    expect(text).toMatch(/feature mapping NOT CHECKED/);
    expect(text).toMatch(/has NOT[\s\S]{0,40}established that the symbol maps to no feature/);
    expect(text).toMatch(/Do not read it as unmapped/);
  });

  it('names the disambiguating next step, not just the same question again', async () => {
    // Telling a reader "this was ambiguous" without a way to resolve it leaves them where
    // they started. Narrowing the target is the move that works.
    const text = asText(await graphPacket({ repoRoot, target: 'GpuMaterial' }));

    expect(text).toMatch(/pick a candidate above, then graph_consequences/);
  });
});
