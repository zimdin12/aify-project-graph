// TWO WALKERS, TWO ADMISSION POLICIES, AND THE WEAKER ONE WON SILENTLY.
//
// The structural sweep decides what enters the graph using `loadEffectiveIgnoredDirs`, which folds
// in `.gitignore`, `.aifyignore` and `.aifyinclude`. Framework plugins do their OWN filesystem walk
// through `walkFiles`, which defaulted to the bare `IGNORED_DIRS` constant — a hardcoded list of
// directory names that never reads `.gitignore`.
//
// ⛔ ef-manager found it from outside, and only because they checked node TYPES rather than counts:
// 3 `Test` nodes in this repo's live graph sourced from
// `reference/graphify/tests/fixtures/sample_doctest.cpp`, under `.gitignore:12 reference/`, a path
// `git ls-files --error-unmatch` rejects. Directory nodes past an exclusion are a tree walk;
// CONTENT nodes past one mean something read a file it was told not to.
//
// ⚠ ALL ELEVEN CALL SITES WERE AFFECTED. Every plugin calls `walkFiles(repoRoot, exts)` and none
// passes `ignored` — django, nestjs, node_web, python_web, rails, spring, shader_bindings and
// cpp_frameworks alike. This repo showed only 3 nodes because `reference/` holds little those
// plugins parse; a repo with a gitignored vendor or build tree full of .py/.ts/.rb/.java turns all
// of it into first-party symbols.
//
// ★ AND THE COMMENT THIS REPLACED RECORDS THE SAME BUG ONE GENERATION EARLIER — "R2-2026-05-31 BUG
// 3: the previous local list omitted `.claude` / `worktrees`, so `.claude/worktrees/` agent shader
// copies were indexed as first-party ShaderBinding nodes." The remedy then was to SHARE THE NAME
// LIST, which makes two copies agree about the names on it and says nothing about the names that
// were never on it. Membership by name, for the third time in this codebase. Sharing the PREDICATE
// is what closes it.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles } from '../../../mcp/stdio/ingest/frameworks/_plugin_utils.js';

let root;
afterEach(async () => {
  if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
  root = undefined;
});

async function repo(gitignore) {
  root = await mkdtemp(join(tmpdir(), 'apg-walk-'));
  await writeFile(join(root, '.gitignore'), gitignore);
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'borrowed', 'nested'), { recursive: true });
  await writeFile(join(root, 'src', 'first_party.cpp'), 'int main(){}\n');
  await writeFile(join(root, 'borrowed', 'nested', 'third_party.cpp'), 'int other(){}\n');
  return root;
}

const names = (paths) => paths.map((p) => p.replace(/\\/g, '/').split('/').pop()).sort();

describe('walkFiles honours the same exclusions as the sweep', () => {
  it('★★★ a gitignored directory is NOT walked — and the control proves the walk ran', async () => {
    // ⛔ WITHOUT THE POSITIVE HALF THIS PASSES ON A BROKEN WALKER. An empty result satisfies "the
    // ignored file is absent" perfectly, and a walk that returns nothing at all looks identical to
    // a walk that correctly excluded one thing. Both assertions, one call.
    const r = await repo('borrowed/\n');
    const found = names(await walkFiles(r, ['.cpp']));

    expect(found, 'the first-party file must be found, or this proves nothing')
      .toContain('first_party.cpp');
    expect(found, 'the gitignored file must not be').not.toContain('third_party.cpp');
    expect(found).toEqual(['first_party.cpp']);
  }, 20_000);

  it('★★★ with the directory NOT ignored, the same file IS walked', async () => {
    // The negative control on the exclusion itself. If `third_party.cpp` were unreachable for some
    // unrelated reason — depth, extension, the size cap — the test above would pass without the
    // gitignore doing any work at all. Changing ONLY the .gitignore must change the answer.
    const r = await repo('# nothing ignored here\n');
    const found = names(await walkFiles(r, ['.cpp']));

    expect(found, 'the exclusion is what removed it, not the walker missing it')
      .toEqual(['first_party.cpp', 'third_party.cpp']);
  }, 20_000);

  it('★★★ an explicit `ignored` set still overrides — the parameter is not dead', async () => {
    // The default became strict; the escape hatch stays for a caller with a genuinely different
    // policy. Asserting it because a fix that silently removes a capability is its own defect.
    const r = await repo('borrowed/\n');
    const found = names(await walkFiles(r, ['.cpp'], { ignored: new Set() }));

    expect(found, 'an explicit empty set means walk everything')
      .toEqual(['first_party.cpp', 'third_party.cpp']);
  }, 20_000);
});
