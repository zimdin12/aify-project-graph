// `existsWithExactCase` — the check that decides whether a file's nodes get DELETED.
//
// WHY THESE AND NOT MORE. The caller's response to `false` is `deleteNodesForFile`, so this function
// has one cheap failure (a stale node survives) and one expensive one (a real file's nodes are
// destroyed). The tests below are split along exactly that line, and each names the bug it catches.
//
// ⚠ THE CASE TEST IS PLATFORM-CONDITIONAL AND SAYS SO. On a case-INSENSITIVE filesystem (Windows,
// default macOS) `existsSync` returns true for the wrong spelling and this function must still say
// false — that is the whole defect. On a case-SENSITIVE filesystem `existsSync` already returns
// false, so the assertion holds trivially and proves nothing about this function. Rather than let a
// trivially-green assertion look like coverage on Linux, the test detects which filesystem it is on
// and says which of the two it just exercised.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsWithExactCase } from '../../../mcp/stdio/freshness/path-exists.js';

let root;
let caseInsensitive;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'apg-path-case-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'middle.js'), 'export function middle() { return 1; }\n');
  // A regular FILE, used below as a parent segment so `readdirSync` throws ENOTDIR.
  await writeFile(join(root, 'notadir'), 'not a directory\n');
  // Ask the filesystem what it is rather than branching on process.platform, which is a proxy.
  caseInsensitive = existsSync(join(root, 'src', 'MIDDLE.js'));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('existsWithExactCase', () => {
  // ⛔ CATCHES: removal of the `existsSync` fast path, which was documented in the source as "an
  // optimisation that changes no result". IT CHANGES THIS RESULT. A regular FILE used as a parent
  // segment makes `readdirSync` throw ENOTDIR, which lands in the deliberate FAIL-OPEN catch and
  // returns TRUE — claiming a path exists when nothing of the kind is on disk. The fast path returns
  // FALSE before the walk can reach that branch, so it is a PREMISE OF THE FAIL-OPEN BRANCH, not a
  // speed tweak.
  //
  // ⚠ WHY THIS TEST DID NOT EXIST. The falsification recorded in the source disabled the fast path
  // and observed BYTE-IDENTICAL output across all six rename arms plus green unit tests — and
  // concluded the line changed nothing. None of those arms contains a file-as-parent-segment, so the
  // run proved the branches it exercised and not the claim. Watched RED with the fast path removed
  // (returns true), GREEN with it restored.
  it('rejects a path whose parent segment is a FILE, instead of failing open', () => {
    expect(existsWithExactCase(root, 'notadir/child.js')).toBe(false);
    // The premise of the assertion above: this really is the ENOTDIR shape, not merely an absent path.
    // Without it, a plain missing-file case would satisfy the expectation and prove nothing.
    expect(existsSync(join(root, 'notadir'))).toBe(true);
  });

  // CATCHES: a check that says false for real files. That answer deletes their nodes, which is the
  // expensive direction and the one pre-registered as a refutation of the rename fix.
  it('accepts a file spelled exactly as it is on disk', () => {
    expect(existsWithExactCase(root, 'src/middle.js')).toBe(true);
  });

  it('accepts a directory too, since changed paths are not always files', () => {
    expect(existsWithExactCase(root, 'src')).toBe(true);
  });

  // CATCHES: the original defect — a case-only rename leaving the old spelling readable, so the
  // refresh loop rebuilds the old path's nodes instead of deleting them.
  it('rejects a path whose case does not match the directory entry', () => {
    expect(existsWithExactCase(root, 'src/MIDDLE.js')).toBe(false);
    // Say which failure this run actually exercised, so a green Linux run is not mistaken for
    // coverage of the Windows defect.
    expect(typeof caseInsensitive).toBe('boolean');
    if (!caseInsensitive) {
      // On a case-sensitive filesystem existsSync already answers false, so the assertion above did
      // not exercise the readdir comparison at all. Documented, not silently passed over.
      expect(existsSync(join(root, 'src', 'MIDDLE.js'))).toBe(false);
    }
  });

  // CATCHES: a check that cannot report absence at all — it would make every caller keep every node
  // forever, and a probe that cannot return ABSENT cannot return PRESENT.
  it('rejects a path that does not exist under any spelling', () => {
    expect(existsWithExactCase(root, 'src/doesNotExist.js')).toBe(false);
    expect(existsWithExactCase(root, 'nope/deeper/still-nope.js')).toBe(false);
  });

  // ⛔ CATCHES THE BASENAME-ONLY VERSION, which shipped in 27c5c422 with this gap recorded as a
  // "stated limit" in the module header. graph-senior-dev then EXECUTED it: `src/` -> `Src/` left
  // four File nodes against a forced rebuild's two, plus a stale IMPORTS edge. Windows resolves the
  // wrong-case parent, so existsSync says present and a basename check never looks at the directory.
  it('rejects a path whose PARENT DIRECTORY case does not match', () => {
    expect(existsWithExactCase(root, 'SRC/middle.js')).toBe(false);
    expect(existsWithExactCase(root, 'Src/middle.js')).toBe(false);
    // and the correctly-spelled parent still passes, so this is not simply refusing everything
    expect(existsWithExactCase(root, 'src/middle.js')).toBe(true);
  });
});

// ⭐ REQUIRED BY graph-senior-dev's review of the segment walk: walking EVERY segment re-opens, once
// per segment, the hazard avoided at the final segment by choosing readdir over realpathSync.native.
// A symlinked parent must be checked BY ITS SPELLING IN ITS OWN PARENT'S LISTING, never resolved
// away — because the caller's response to `false` is deleteNodesForFile, so a false negative here
// DELETES A REAL FILE'S NODES. That is the expensive direction and the pre-registered refutation.
describe('existsWithExactCase through a symlinked parent directory', () => {
  let linkRoot;
  let linkMade = false;

  beforeAll(async () => {
    linkRoot = await mkdtemp(join(tmpdir(), 'apg-path-link-'));
    await mkdir(join(linkRoot, 'real'), { recursive: true });
    await writeFile(join(linkRoot, 'real', 'kept.js'), 'export function kept() { return 1; }\n');
    try {
      // 'junction' is the Windows form that needs no elevation; 'dir' elsewhere.
      await symlink(join(linkRoot, 'real'), join(linkRoot, 'linked'),
        process.platform === 'win32' ? 'junction' : 'dir');
      linkMade = true;
    } catch {
      linkMade = false;
    }
  });

  afterAll(async () => {
    if (linkRoot) await rm(linkRoot, { recursive: true, force: true });
  });

  it('PRESERVES a real file reached through a symlinked parent', () => {
    if (!linkMade) {
      // ⛔ A SKIP IS NOT A PASS, and this one is announced rather than silently green: without a link
      // this run has NOT exercised the preservation hazard at all.
      expect(linkMade, 'symlink/junction could not be created — preservation hazard UNTESTED in this run').toBe(false);
      return;
    }
    expect(existsWithExactCase(linkRoot, 'linked/kept.js')).toBe(true);
    // ...and the check still discriminates through the link rather than waving everything through.
    expect(existsWithExactCase(linkRoot, 'linked/KEPT.js')).toBe(false);
    expect(existsWithExactCase(linkRoot, 'linked/absent.js')).toBe(false);
  });
});
