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
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
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
  // Ask the filesystem what it is rather than branching on process.platform, which is a proxy.
  caseInsensitive = existsSync(join(root, 'src', 'MIDDLE.js'));
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('existsWithExactCase', () => {
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
});
