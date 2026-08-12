// THE DISCRIMINATOR THE FIRST FIX LACKED.
//
// `graphIdentity()` originally hashed only top-level FILES, so two graph states differing
// solely in nested content produced the SAME digest. I fixed that and shipped it bundled with
// an unrelated commit-attribution change — with no test for the one case the fix existed for.
//
// graph-senior-dev-hermes required the split and this matrix, and the reason generalises:
// **a fix whose specific failure case is untested is a claim, not a repair.** Every arm below
// is a state pair that the OLD implementation could not tell apart, plus the negative controls
// that stop this suite from passing vacuously.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { graphIdentity } from '../../scripts/graph-identity.mjs';

const made = [];
const fixture = (build) => {
  const root = mkdtempSync(join(tmpdir(), 'apg-gid-'));
  made.push(root);
  const dir = join(root, '.aify-graph');
  mkdirSync(dir, { recursive: true });
  // Every fixture shares identical TOP-LEVEL files. That is the point: the old implementation
  // hashed exactly these and nothing else, so any arm it can still distinguish is an arm that
  // is not testing the defect.
  writeFileSync(join(dir, 'manifest.json'), '{"nodes":1}');
  writeFileSync(join(dir, 'brief.md'), '# brief');
  build(dir);
  return dir;
};
afterEach(() => { while (made.length) { try { rmSync(made.pop(), { recursive: true, force: true }); } catch { /* windows lock */ } } });

const digestOf = (dir) => graphIdentity(dir).digest;

describe('graphIdentity identifies NESTED state, which the top-level walk could not', () => {
  it('★★ POSITIVE CONTROL — two identical trees agree (else every arm below passes vacuously)', () => {
    const a = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'x.json'), 'same'); });
    const b = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'x.json'), 'same'); });
    expect(digestOf(a), 'a digest must be produced at all').toBeTruthy();
    expect(digestOf(a)).toBe(digestOf(b));
  });

  it('★★ NESTED CONTENT — the exact case the old implementation missed', () => {
    const a = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'x.json'), 'one'); });
    const b = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'x.json'), 'two'); });
    // Top-level entries are byte-identical in both, so the old walk returned equal digests.
    expect(digestOf(a)).not.toBe(digestOf(b));
  });

  it('★★ NESTED RENAME — same bytes, different path, different identity', () => {
    const a = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'before.json'), 'payload'); });
    const b = fixture((d) => { mkdirSync(join(d, 'sub')); writeFileSync(join(d, 'sub', 'after.json'), 'payload'); });
    expect(digestOf(a)).not.toBe(digestOf(b));
  });

  it('★★ TYPE CHANGE — a file replaced by a directory of the same name', () => {
    const a = fixture((d) => { writeFileSync(join(d, 'thing'), ''); });
    const b = fixture((d) => { mkdirSync(join(d, 'thing')); });
    expect(digestOf(a)).not.toBe(digestOf(b));
  });

  it('★★ EMPTY DIRECTORY IS MATERIAL — stated policy, asserted rather than assumed', () => {
    const a = fixture(() => {});
    const b = fixture((d) => { mkdirSync(join(d, 'empty')); });
    // If directory presence were ever made immaterial, this fails and the policy comment in
    // graph-identity.mjs must change with it — the two cannot drift apart silently.
    expect(digestOf(a)).not.toBe(digestOf(b));
  });

  it('★★ DEPTH — a difference three levels down still moves the identity', () => {
    const build = (leaf) => (d) => {
      mkdirSync(join(d, 'a', 'b', 'c'), { recursive: true });
      writeFileSync(join(d, 'a', 'b', 'c', 'deep.json'), leaf);
    };
    expect(digestOf(fixture(build('x')))).not.toBe(digestOf(fixture(build('y'))));
  });

  it('★★ ORDER INDEPENDENCE — creation order must not change identity', () => {
    const a = fixture((d) => {
      mkdirSync(join(d, 'sub'));
      writeFileSync(join(d, 'sub', 'a.json'), '1');
      writeFileSync(join(d, 'sub', 'b.json'), '2');
    });
    const b = fixture((d) => {
      mkdirSync(join(d, 'sub'));
      writeFileSync(join(d, 'sub', 'b.json'), '2');
      writeFileSync(join(d, 'sub', 'a.json'), '1');
    });
    expect(digestOf(a), 'readdirSync is sorted, so order must not leak in').toBe(digestOf(b));
  });
});

describe('graphIdentity refuses rather than reporting a partial identity', () => {
  it('★★ TYPED ABSENCE — a missing directory is a stated condition, not a missing key', () => {
    const res = graphIdentity(join(tmpdir(), 'apg-gid-definitely-not-here-9f3a'));
    expect(res.present).toBe(false);
    expect(res.reason).toMatch(/absent/);
    expect(res, 'absence must not masquerade as an empty identity').not.toHaveProperty('digest');
  });

  it('★★ SYMLINK — fails CLOSED, because stat() would have followed it out of the population', (ctx) => {
    let dir;
    try {
      dir = fixture((d) => {
        mkdirSync(join(d, 'sub'));
        writeFileSync(join(d, 'sub', 'real.json'), 'payload');
        symlinkSync(join(d, 'sub', 'real.json'), join(d, 'link.json'));
      });
    } catch (e) {
      // ⛔ ctx.skip(), NOT `return`. The first version returned early on Windows EPERM, so this
      // arm PASSED having asserted nothing — and `scripts/self-review.mjs` proved it: deleting
      // the symlink fail-closed branch entirely left this test GREEN (SURVIVED). A silent early
      // return is a green result that checked nothing, which is the same defect I converted out
      // of another test in this repo this morning and then rebuilt here within hours.
      //
      // Skipping is REPORTED, so a machine that cannot create symlinks shows an absent arm
      // rather than a satisfied one.
      expect(e.code, 'unexpected failure creating the symlink fixture').toMatch(/EPERM|EACCES/);
      ctx.skip();
      return;
    }
    const res = graphIdentity(dir);
    expect(res.present).toBe(true);
    expect(res.digest, 'a population containing a symlink is not fully covered').toBeNull();
    expect(res.incomplete.join(' ')).toMatch(/symbolic link/);
  });

  it('★★ full SHA-256, not a truncation — an identity does not discard 192 bits for readability', () => {
    const d = fixture((x) => { mkdirSync(join(x, 'sub')); writeFileSync(join(x, 'sub', 'x.json'), 'v'); });
    expect(graphIdentity(d).digest).toMatch(/^[0-9a-f]{64}$/);
  });
});
