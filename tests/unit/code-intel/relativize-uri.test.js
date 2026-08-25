import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { relativizeUri } from '../../../mcp/stdio/code-intel/providers/lsp-collect.js';

// ⛔ THE TEST THAT A COMMENT COULD NOT BE.
//
// `relativizeUri`'s fallback read `try { return toRepoRelative(uri, realRoot); } catch { return uri; }`
// — arguments REVERSED (the signature is `toRepoRelative(projectRoot, filePath)`) so it always threw,
// and a catch that returned its own input, writing a raw percent-encoded file:// URI into
// `file_path`.
//
// ⛔⛔ AND A COMMENT TEN LINES BELOW DESCRIBED THAT EXACT DEFECT, in a copy deleted for being a trap,
// while the live one stood. It even explained why the dead copy was harmless — "it was never
// called" — the one property the live copy did not have.
//
// ⇒ The most accurate description of the bug in the repository sat ten lines from the bug and did
// not prevent it. This file is the instrument the comment was not.
//
// ⚠ END-TO-END EVIDENCE IS SEPARATE AND ALREADY TAKEN: a clean rebuild of the click corpus followed
// by a collection reported `outOfRepoSkipped: 12` with `0` file:// nodes in the graph. The 12 is
// what makes the 0 meaningful — it proves the language server DID resolve outside the repository
// during that run, so the fix was exercised rather than merely unprovoked.

let repo;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'apg-relativize-'));
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'lib.py'), '# x\n');
});
afterEach(() => { if (repo) { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } } });

const uriFor = (p) => pathToFileURL(p).toString();

describe('relativizeUri — in-repo returns a path, out-of-repo returns null', () => {
  it('⭐ POSITIVE CONTROL: a file inside the repo relativizes', () => {
    // Without this, every assertion below is satisfied by a function that returns null always.
    expect(relativizeUri(uriFor(join(repo, 'src', 'lib.py')), repo)).toBe('src/lib.py');
  });

  it('⛔ a path OUTSIDE the repo returns null — never the URI', () => {
    // The exact shape observed in the wild: pyright resolving an import into the operator's
    // installed site-packages copy of the library, which is a DIFFERENT COPY than the one under
    // edit. Storing it pointed agents out of their own working tree.
    const outside = mkdtempSync(join(tmpdir(), 'apg-elsewhere-'));
    try {
      writeFileSync(join(outside, 'core.py'), '# not ours\n');
      expect(relativizeUri(uriFor(join(outside, 'core.py')), repo)).toBeNull();
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it('⛔ a percent-encoded Windows-style file URI outside the repo returns null', () => {
    // The literal value found in click's graph, minus the machine-specific prefix. It must not
    // survive as a path under any encoding.
    const uri = 'file:///c%3A/Users/Someone/AppData/Roaming/Python/Python314/site-packages/click/core.py';
    expect(relativizeUri(uri, repo)).toBeNull();
  });

  it('⛔ a bundled-stub path from OUR OWN installation returns null', () => {
    // The second leak: pyright reads its typeshed stubs out of aify-project-graph's node_modules,
    // and those were being imported into a third-party project's graph.
    const uri = 'file:///c%3A/Docker/aify-project-graph/node_modules/pyright/dist/typeshed-fallback/stdlib/types.pyi';
    expect(relativizeUri(uri, repo)).toBeNull();
  });

  it('⛔ an unparseable URI returns null rather than passing itself through', () => {
    // The old catch returned its input for ANY failure, so a malformed value became a `file_path`.
    expect(relativizeUri('not-a-uri-at-all', repo)).toBeNull();
    expect(relativizeUri('', repo)).toBeNull();
  });

  it('⭐ null is returned for every out-of-repo shape, and a path for in-repo — it discriminates', () => {
    // A function that always returns null passes each negative test individually. Counting both
    // outcomes in one pass is the cheapest proof it is not simply refusing everything.
    const inRepo = [join(repo, 'src', 'lib.py')].map((p) => relativizeUri(uriFor(p), repo));
    const outside = [
      'file:///c%3A/Users/Someone/site-packages/click/core.py',
      'file:///c%3A/Docker/aify-project-graph/node_modules/pyright/x.pyi',
      'not-a-uri-at-all',
    ].map((u) => relativizeUri(u, repo));

    expect(inRepo.every((r) => typeof r === 'string' && r.length > 0)).toBe(true);
    expect(outside.every((r) => r === null)).toBe(true);
  });
});
