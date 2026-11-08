// #14 probe: can a provider anchor make APG read a file outside the repository?
// Builds a scratch git repo beside an "outside" directory holding a marker file, then resolves anchors through the
// REAL instruments both entry points use: the commit reader (the provider queue) and the working-tree reader
// (sweep, reconfirm). No credential file is touched; the outside file is the scratch marker.
// Usage: node docs/evidence/issue-14-provider-paths/probe.mjs
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolveAnchor } from '../../../scripts/lib/anchor-resolver.mjs';
import { makeInstruments } from '../../../scripts/lib/provider-runtime.mjs';

const MARKER = 'outside-marker-content\n';
const base = mkdtempSync(join(tmpdir(), 'apg-14-'));
const repo = join(base, 'repo');
const outside = join(base, 'outside');
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
const sha = (text) => createHash('sha256').update(JSON.stringify(text.replaceAll('\r\n', '\n'))).digest('hex');
try {
  mkdirSync(repo); mkdirSync(outside);
  writeFileSync(join(outside, 'marker.dat'), MARKER);
  writeFileSync(join(repo, 'inside.dat'), 'inside\n');
  git('init', '-q');
  git('config', 'user.email', 'probe@example.invalid'); git('config', 'user.name', 'probe');
  git('add', 'inside.dat');
  // A committed symlink pointing outside, written as a git object so no filesystem symlink privilege is needed.
  const target = '../outside/marker.dat';
  const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', '--stdin'], { input: target, encoding: 'utf8' }).trim();
  git('update-index', '--add', '--cacheinfo', `120000,${blob},link.dat`);
  git('commit', '-q', '-m', 'probe');
  const head = git('rev-parse', 'HEAD');
  let worktreeLink = 'not created';
  try { symlinkSync(join(outside, 'marker.dat'), join(repo, 'link.dat')); worktreeLink = 'created'; } catch (e) { worktreeLink = `not created (${e.code})`; }

  const anchors = ['inside.dat', '../outside/marker.dat', join(outside, 'marker.dat').replaceAll('\\', '/'), 'link.dat'];
  const which = (hash) => (hash === sha(MARKER) ? 'MARKER CONTENT (outside file read)'
    : hash === sha(target) ? 'link target text (the symlink itself)' : hash === sha('inside\n') ? 'inside.dat content' : 'other');
  for (const [label, deps] of [['commit reader (provider queue)', makeInstruments(repo, { at: head })],
    [`working-tree reader (sweep, reconfirm; worktree symlink ${worktreeLink})`, makeInstruments(repo)]]) {
    console.log(label);
    for (const path of anchors) {
      const out = resolveAnchor({ repoRoot: repo, item: { watchId: 'w', anchor: { path, kind: 'file' }, stamp: null }, deps });
      const verdict = out.kind === 'unwatched' ? `unwatched ${out.row.reasonCode}` : out.row.status;
      console.log(`  ${path.padEnd(48)} ${verdict.padEnd(10)} ${out.row.stamp ? which(out.row.stamp.hash) : ''}`);
    }
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
