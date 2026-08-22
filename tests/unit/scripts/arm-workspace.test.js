// ⛔ THE OPEN ITEM, CLOSED STRUCTURALLY RATHER THAN CAREFULLY.
//
// self-review mutated files in THE CHECKOUT THE TEAM IS WORKING IN. The `finally` restore covers a
// thrown error; it does not cover SIGKILL, a power loss, or a closed terminal, and the residue is
// quiet because a mutant is a plausible edit to a real file, not a syntax error.
//
// The weak fix is to audit every call site and be careful. That fails the moment someone adds a
// thirty-first arm and copies the wrong line. ⇒ THE MAIN WORKSPACE HAS NO WORKING `write`, so the
// dangerous state is not merely unwritten — it is unconstructible.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Workspace, ReadOnlyWorkspaceError, mainRepoWorkspace,
} from '../../../scripts/lib/arm-workspace.mjs';
import {
  writesTargeting, writesTargetingOutside, MUTATING_FS_CALLS,
} from '../../../scripts/lib/write-target-audit.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ws-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'a.js'), 'original\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

describe('the main checkout cannot be mutated', () => {
  it('★★★⛔ a write into the read-only workspace THROWS, naming the rule', () => {
    const ws = mainRepoWorkspace(dir);
    expect(() => ws.write('src/a.js', 'MUTANT')).toThrow(ReadOnlyWorkspaceError);
    expect(readFileSync(join(dir, 'src', 'a.js'), 'utf8'),
      'and the bytes on disk are untouched — a throw that still wrote would be worse than no guard')
      .toBe('original\n');
  });

  it('★★★ POSITIVE CONTROL: the same workspace READS fine', () => {
    // Reads must stay open: computing a mutant requires reading the pristine source. Without this
    // the refusals above are satisfied by an object that does nothing at all.
    expect(mainRepoWorkspace(dir).read('src/a.js')).toBe('original\n');
  });

  it('★★★ POSITIVE CONTROL: a WRITABLE workspace really does write', () => {
    const ws = new Workspace(dir, { writable: true, kind: 'test' });
    ws.write('src/a.js', 'MUTANT');
    expect(readFileSync(join(dir, 'src', 'a.js'), 'utf8')).toBe('MUTANT');
  });

  it('★★★⛔ writable FAILS CLOSED — anything but an explicit true is read-only', () => {
    // ⚠ A truthy-but-not-true value is exactly how a config typo becomes a writable main checkout.
    for (const v of [undefined, null, 1, 'yes', {}]) {
      expect(() => new Workspace(dir, { writable: v, kind: 't' }).write('src/a.js', 'X'),
        `writable:${JSON.stringify(v)} must not grant writes`).toThrow(ReadOnlyWorkspaceError);
    }
  });

  it('★★★⛔ mainRepoWorkspace takes NO option to make it writable', () => {
    // Offering the option is offering the defect: the whole value is that no call site can opt in.
    expect(mainRepoWorkspace.length, 'exactly one parameter: the repo path').toBe(1);
    expect(mainRepoWorkspace(dir).writable).toBe(false);
  });
});

describe('a workspace path cannot escape its root', () => {
  it('★★★⛔ A JUNCTION CANNOT WALK THROUGH CONTAINMENT — lexical was not enough', async () => {
    // ⛔ THE ESCAPE, DEMONSTRATED BEFORE IT WAS FIXED. `path()` used resolve()+relative(), which is
    // STRING arithmetic: it catches `..` and cannot see a junction, because a junction is lexically
    // inside the root and physically anywhere.
    //
    //     ../escaped.txt   REFUSED     the lexical check does work
    //     ok.txt           wrote       the instrument can write
    //     deps/pwned.txt   ACCEPTED    and the bytes landed OUTSIDE the root
    //
    // ⛔⛔ AND THIS MODULE CREATES EXACTLY SUCH A JUNCTION IN EVERY ARM: openArmWorkspace links
    // <arm>/node_modules to the MAIN CHECKOUT's node_modules. One path per arm was lexically
    // contained and physically inside the tree this module exists to protect.
    //
    // ⇒ The same junction was ALREADY guarded for the other operation — disposeArmWorkspace removes
    // it first, and says why. Same junction, two operations, reasoned through for DELETE and never
    // taught to WRITE. Found by ef-manager reviewing 1c05bde.
    const outside = join(dir, '..', `outside-${Date.now()}`);
    mkdirSync(outside, { recursive: true });
    const ws = new Workspace(dir, { writable: true, kind: 't' });
    try {
      execFileSync('cmd', ['/c', 'mklink', '/J', join(dir, 'deps'), outside], { stdio: 'ignore' });
    } catch {
      // No junction support (non-Windows, or no permission): the case cannot be constructed here.
      // ⚠ Skipping SILENTLY would make this test a decoration, so it fails loudly instead of
      // pretending to have checked something.
      expect.fail('could not create a junction — this control cannot run on this platform and must '
        + 'not report a pass it did not earn');
    }
    expect(() => ws.write('deps/pwned.txt', 'x'),
      'a junction is lexically inside and physically outside').toThrow(/outside the workspace root/);
    expect(existsSync(join(outside, 'pwned.txt')), 'and no bytes reached the far side').toBe(false);
    rmSync(outside, { recursive: true, force: true, maxRetries: 3 });
  });

  it('★★★ POSITIVE CONTROL: the realpath check did not become a lobotomy', () => {
    // ⛔ Without this, the refusal above is satisfied by a path() that refuses everything — which
    // would pass the control that motivated the change while making the workspace unusable.
    const ws = new Workspace(dir, { writable: true, kind: 't' });
    ws.write('src/a.js', 'still writes');
    expect(readFileSync(join(dir, 'src', 'a.js'), 'utf8')).toBe('still writes');
  });

  it('★★★⛔ traversal and absolute paths are refused', () => {
    // This object stands between a mutation and the rest of the disk, so a relative path is not
    // automatically inside the root.
    const ws = new Workspace(dir, { writable: true, kind: 't' });
    expect(() => ws.path('../outside.js')).toThrow(/outside the workspace root/);
    expect(() => ws.path('src/../../outside.js')).toThrow(/outside the workspace root/);
    expect(() => ws.path('C:/Windows/system32/x')).toThrow(/absolute/);
    expect(ws.path('src/a.js'), 'POSITIVE CONTROL: an ordinary path resolves').toContain('a.js');
  });
});

// ⛔ A STRUCTURAL LINT, AND ITS LIMIT STATED UP FRONT. This cannot see indirection — a path passed
// through a helper or built in another module is invisible to it. The real guarantee is that the
// main workspace's `write()` throws. This exists so a regression is caught at review time rather
// than at kill time, and a clean result must not be read as proof of unreachability.
describe('no mutation path in self-review can target the main checkout', () => {
  const SELF_REVIEW = 'scripts/self-review.mjs';
  const src = () => readFileSync(SELF_REVIEW, 'utf8');

  it('★★★⛔ THE CLAIM: zero writes to REPO outside the run-evidence directory', () => {
    const bad = writesTargetingOutside(src(), 'REPO', ['.self-review-raw'], SELF_REVIEW);
    expect(bad.map((b) => `${b.line}: ${b.text}`), 'every mutation and restore must go through a Workspace').toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: the audit FINDS a write when one is there', () => {
    // ⛔ Without this the assertion above is satisfied by an audit that returns [] unconditionally —
    // which is exactly the shape of defect that has bitten this repo four times today.
    const hits = writesTargeting("writeFileSync(join(REPO, f), content);", 'REPO');
    expect(hits.length).toBe(1);
    expect(hits[0].call).toBe('writeFileSync');
  });

  it('★★★ NEGATIVE CONTROL: it does NOT flag reads, or writes to another root', () => {
    expect(writesTargeting("readFileSync(join(REPO, f), 'utf8');", 'REPO'), 'a read is not a write').toEqual([]);
    expect(writesTargeting("writeFileSync(join(WORKTREE, f), c);", 'REPO'), 'another identifier').toEqual([]);
  });

  it('★★★⛔ it catches the spellings a regex for one call would miss', () => {
    // Enumerating syntax is the losing move; this asks the tree what KIND of node it is. Each of
    // these is a real way to write bytes and none matches `writeFileSync(join(REPO`.
    for (const src2 of [
      'fs.appendFileSync(join(REPO, f), x);',
      'fs.rmSync(REPO + "/x", {});',
      'renameSync(target(REPO), other);',
      'createWriteStream(join(REPO, f));',
    ]) {
      expect(writesTargeting(src2, 'REPO').length, src2).toBe(1);
    }
  });

  it('★★★⛔ an unparsable file THROWS rather than reporting a reassuring zero', () => {
    // A silent zero over an unparsed file is the exact failure mode this whole audit exists to
    // avoid: absence of findings that looks identical to absence of defects.
    expect(() => writesTargeting('function ( {{{ broken', 'REPO')).toThrow(/did not parse cleanly/);
  });

  it('★★★ the mutating-call surface is a named set, not an inline regex', () => {
    for (const c of ['writeFileSync', 'appendFileSync', 'rmSync', 'renameSync', 'cpSync']) {
      expect(MUTATING_FS_CALLS.has(c), `${c} must be covered`).toBe(true);
    }
  });
});
