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

  it('★★★ EVERY text document becomes a node — the 52.7% hole, closed', async () => {
    // ⛔ THIS TEST USED TO ASSERT THE HOLE. It expected `admitted.Document` to be 2 and
    // `declined.text_not_admitted_as_document` to be 3, because `SKILL.md`, `install.claude.md`
    // and `src.txt` all failed the twelve-word allowlist. Making the loss VISIBLE was the right
    // first move and this is the second: the allowlist is deleted, so all five are nodes.
    //
    // ⚠ THE COUNTER IS RETIRED RATHER THAN ASSERTED AT ZERO. `isDocument` is now exactly the
    // extension test, so nothing can reach the branch that incremented it. A key that can never be
    // non-zero reads as a check still running and finding nothing — which inverts the reason
    // always-present zeros were published at all.
    //
    // ⇒ So the negative counter is replaced by a POSITIVE statement, which is strictly more
    // informative: every text file that survives the ignore layer is a Document.
    await fixture();
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts.admitted.Document,
      'README.md, docs/design.md, SKILL.md, install.claude.md, src.txt').toBe(5);
    expect(counts.declined.text_not_admitted_as_document,
      'the bucket is retired, not zeroed — a permanent zero is a check that is not running')
      .toBeUndefined();
    expect(counts.declined.not_a_special_kind, 'package.json is admitted, so nothing here')
      .toBe(0);
  }, 30_000);

  it('★★★ install.claude.md and SKILL.md specifically — the two the allowlist named', async () => {
    // ⛔ NAMED RATHER THAN COUNTED, because a count of 5 is satisfied by any five files and these
    // two are the ones the defect was about. `install.claude.md` is the sharpest instance: the
    // allowlist CONTAINED `claude` and refused the file anyway, because `nameNoExt` stripped only
    // the last extension and produced "install.claude". ef-manager found the same parsing accident
    // on echoes, where `AGENTS.md` is admitted and `AGENTS.MANAGER.md` is not.
    await fixture();
    const { nodes } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    const docs = nodes.filter((n) => n.type === 'Document').map((n) => n.file_path);
    expect(docs, 'a NAME.QUALIFIER.md file defeated the list even when NAME was on it')
      .toContain('install.claude.md');
    expect(docs, 'the prose that tells an agent how to use the product')
      .toContain('skills/thing/SKILL.md');
  }, 30_000);

  it('★★★ counts are published even when NOTHING was declined', async () => {
    // ⚠ A field that appears only when something is wrong cannot be told apart from a build that
    // never had the check — the inference a field user correctly drew from a missing
    // `staleProcess` key on 2026-08-07. An always-present zero is what makes a non-zero readable.
    repo = await mkdtemp(join(tmpdir(), 'apg-sweepclean-'));
    await writeFile(join(repo, 'README.md'), '# only an admitted file\n');
    const { counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    expect(counts, 'the shape exists regardless of outcome').toBeTruthy();
    expect(counts.declined.text_not_admitted_as_document, 'retired').toBeUndefined();
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

describe('the sweep consults .gitignore even when git gives no candidate list', () => {
  it('★★★ a gitignored tree is NOT swept when there are no git candidates', async () => {
    // ⛔ SECOND FILE TONIGHT WITH THE SAME FAIL-OPEN DEFAULT.
    //
    // `sweepFilesystem` takes `ignoredDirs = IGNORED_DIRS` — the bare built-in constant. When git
    // DOES give a candidate list, the code re-resolves the ignore set deliberately WITHOUT the
    // manual .gitignore parser, because git's own answer is stricter and handles the `!pattern`
    // re-includes the parser drops. Correct.
    //
    // But when there are NO candidates — a non-git checkout, or git unavailable — `ignoredDirs`
    // kept the default and `.gitignore` was consulted by NOBODY.
    //
    // Measured on the real repo with candidates suppressed: 742 Document nodes, 580 of them under
    // a `.gitignore`d `reference/`, while `declined.ignore_rule` reported 1.
    //
    // ⚠ AND THE TWELVE-WORD DOC ALLOWLIST HAD BEEN MASKING IT. Almost all 580 failed the name
    // test, so they never became nodes and the leak never showed. Deleting the allowlist is what
    // surfaced it — a latent defect revealed by removing what accidentally suppressed it.
    //
    // ★ `walkFiles` in frameworks/_plugin_utils.js had the identical default and leaked 1,046
    // files past the identical `.gitignore`. In both cases the strict resolver was already written
    // and simply was not the default.
    repo = await mkdtemp(join(tmpdir(), 'apg-sweepignore-'));
    await mkdir(join(repo, 'borrowed', 'nested'), { recursive: true });
    await writeFile(join(repo, '.gitignore'), 'borrowed/\n');
    await writeFile(join(repo, 'README.md'), '# mine\n');
    await writeFile(join(repo, 'borrowed', 'nested', 'THIRDPARTY.md'), '# not mine\n');

    // gitCandidates: null is the no-git path — the one that had no ignore policy at all.
    const { nodes, counts } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    const docs = nodes.filter((n) => n.type === 'Document').map((n) => n.file_path);

    expect(docs, 'the first-party document must be swept, or this proves nothing')
      .toContain('README.md');
    expect(docs.join(' '), 'the gitignored tree must not be').not.toContain('THIRDPARTY.md');
    // ⚠ THE PRUNE IS COUNTED AS A DIRECTORY, NOT AS FILES, AND THAT DISTINCTION IS THE FIRST
    // THING THIS TEST TAUGHT ME. My first assertion here demanded `declined.ignore_rule > 0` and
    // got 0 — because a pruned subtree is never enumerated, so its files never become candidates
    // and never reach any file bucket. `seen` must keep meaning "candidate files" or the
    // reconciliation above stops meaning anything.
    //
    // ⛔ BUT A PRUNE THAT LEAVES NO TRACE IS THE ORIGINAL DEFECT WEARING A DIFFERENT HAT. On the
    // real repo, ONE prune hides 580 documents. So it gets its own field, outside the file
    // arithmetic, because a corpus that silently omits a whole tree is how the 52.7% stayed
    // hidden in the first place.
    expect(counts.prunedDirs, 'the subtree is recorded as pruned').toBeGreaterThan(0);
    expect(counts.prunedDirSample.join(' '), 'and it is NAMED, so a reader can check it')
      .toContain('borrowed');
  }, 30_000);

  it('★★★ with the tree NOT gitignored, the same document IS swept', async () => {
    // The negative control. Without it, a sweep that pruned `borrowed/` for an unrelated reason —
    // a built-in name, a depth limit — would satisfy the test above while .gitignore did no work.
    // `borrowed` is deliberately a name the built-in IGNORED_DIRS has never heard of; my first
    // version of this fixture used `vendor/`, which IS built in, and would have passed either way.
    repo = await mkdtemp(join(tmpdir(), 'apg-sweepnoignore-'));
    await mkdir(join(repo, 'borrowed', 'nested'), { recursive: true });
    await writeFile(join(repo, '.gitignore'), '# nothing ignored here\n');
    await writeFile(join(repo, 'README.md'), '# mine\n');
    await writeFile(join(repo, 'borrowed', 'nested', 'THIRDPARTY.md'), '# not mine\n');

    const { nodes } = await sweepFilesystem({ repoRoot: repo, gitCandidates: null });
    const docs = nodes.filter((n) => n.type === 'Document').map((n) => n.file_path);

    expect(docs.join(' '), 'changing ONLY the .gitignore must change the answer')
      .toContain('THIRDPARTY.md');
  }, 30_000);
});

describe('a directory is a node because it CONTAINS something', () => {
  it('★★★ a directory with nothing admissible gets NO node, and one with content does', async () => {
    // ⛔ 343 OF 568 DIRECTORY NODES DESCRIBED A TREE THE GRAPH EXTRACTS NOTHING FROM.
    //
    // The walk called `ensureDirectory` eagerly on every directory it entered — before knowing
    // whether anything inside would be admitted. On the normal path `ignoredDirs` is resolved with
    // `skipGitignore: true`, which is CORRECT (git's candidate list is authoritative for files and
    // handles the `!pattern` re-includes the manual parser drops) — but it means a `.gitignore`d
    // directory is not pruned from the walk. So the walk descended into `reference/`, minted a node
    // per directory, and then declined every file inside as `git_excluded`.
    //
    // Measured: 568 Directory nodes, 343 under `reference/`, ZERO Files there. 60% of the graph's
    // directory structure was a tree with no content.
    //
    // ⚠ AND IT SURFACED THREE TIMES FROM THREE DIRECTIONS before anyone traced it — node types
    // under reference/, 1,046 files exposed by a walker default, two doc links resolving into it.
    // An excluded tree that still has nodes is a HALF-EXCLUSION, and every layer that walks the
    // graph rediscovers it.
    //
    // ⚠ AND NAME THE NOUN. Commit a92a66a's body says "NON-DIRECTORY NODES UNCHANGED AT 222" as its
    // evidence for "nothing lost". 222 is the count of non-Directory nodes IN sweepFilesystem's OWN
    // RETURN VALUE — Config 61 + Document 154 + Entrypoint 7. It is NOT a repo-wide figure: the
    // graph holds 4,390 non-Directory nodes, because plain source files are declined by the sweep
    // (`not_a_special_kind`) and their File/Function nodes come from the language extractors.
    //
    // ef-manager could not reconcile 222 against any population they could name, and said so rather
    // than assuming it was wrong. They were right: the FIELD was correct and the NOUN was too broad,
    // which is the defect this repo has spent the night on in every other layer. The repo-wide
    // support for the same conclusion is 4945 - 4601 = 344 nodes removed against 357 Directory nodes
    // removed — confined to Directory nodes, from figures anyone can identify.
    repo = await mkdtemp(join(tmpdir(), 'apg-lazydir-'));
    await mkdir(join(repo, 'kept'), { recursive: true });
    await mkdir(join(repo, 'empty', 'deeper'), { recursive: true });
    await writeFile(join(repo, 'kept', 'README.md'), '# kept\n');
    // A file that exists on disk and is NOT a git candidate — the shape `reference/` has.
    await writeFile(join(repo, 'empty', 'deeper', 'vendored.md'), '# not ours\n');

    const tracked = new Set(['kept/README.md']);
    const { nodes } = await sweepFilesystem({ repoRoot: repo, gitCandidates: tracked });
    const dirs = nodes.filter((n) => n.type === 'Directory').map((n) => n.file_path);

    // ⛔ THE POSITIVE HALF FIRST. A sweep that created NO directory nodes at all would satisfy the
    // exclusion assertion perfectly, and "no phantom directories" is trivially true of a walker
    // that produces nothing.
    expect(dirs, 'a directory holding an admitted file is still a node').toContain('kept');
    expect(dirs, 'and the root is always present').toContain('.');

    expect(dirs, 'a directory whose only file was excluded is not structure worth recording')
      .not.toContain('empty');
    expect(dirs, 'nor is its child').not.toContain('empty/deeper');
  }, 30_000);

  it('★★★ the parent chain of an admitted file is created in full', async () => {
    // The control on laziness. Creating directories only when a file is admitted must still create
    // EVERY ancestor — a deep file whose grandparent is missing would leave the CONTAINS chain
    // broken, which is a worse defect than the phantom nodes this replaced.
    repo = await mkdtemp(join(tmpdir(), 'apg-lazydir-deep-'));
    await mkdir(join(repo, 'a', 'b', 'c'), { recursive: true });
    await writeFile(join(repo, 'a', 'b', 'c', 'README.md'), '# deep\n');

    const { nodes, edges } = await sweepFilesystem({
      repoRoot: repo, gitCandidates: new Set(['a/b/c/README.md']),
    });
    const dirs = nodes.filter((n) => n.type === 'Directory').map((n) => n.file_path);
    for (const expected of ['.', 'a', 'a/b', 'a/b/c']) {
      expect(dirs, `the chain must be unbroken at ${expected}`).toContain(expected);
    }
    // And the chain must be LINKED, not merely present.
    const contains = edges.filter((e) => e.relation === 'CONTAINS').map((e) => `${e.from_path}>${e.to_path}`);
    expect(contains).toContain('.>a');
    expect(contains).toContain('a>a/b');
    expect(contains).toContain('a/b>a/b/c');
  }, 30_000);
});
