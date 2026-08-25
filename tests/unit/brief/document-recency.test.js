// ⛔ THE TRANSPORT WAS UNSAFE IN TWO WAYS AND BOTH FAILED SILENTLY IN THE REASSURING DIRECTION.
//
// the reviewer flagged them before this shipped:
//
//   1. Every document path passed as argv. On a doc-heavy repo that exceeds the command-line
//      limit, ONE call throws, the catch returns an empty map, and EVERY document becomes UNKNOWN.
//      The ranking loses a whole signal and says nothing about having lost it.
//   2. Line-splitting. git quotes paths containing spaces or non-ASCII unless told otherwise, so
//      those paths parse into something that matches no document and are silently undated.
//
// ★ AND FIXING (2) INTRODUCED A THIRD THAT ONLY A COUNT CAUGHT. git writes a newline AFTER the NUL
// terminating each record, so splitting on NUL alone yields path tokens with a leading newline. The
// map still FILLED — 189 entries for 156 input paths, every key subtly wrong — so "did we get
// dates?" passed while every lookup missed. A populated wrong answer survives review; an empty one
// would not have.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { documentRecency } from '../../../mcp/stdio/brief/extract.js';

let repo;
afterEach(async () => {
  if (repo) { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } }
  repo = undefined;
});

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });

async function repoWith(paths) {
  repo = await mkdtemp(join(tmpdir(), 'apg-recency-'));
  git('init', '-q');
  for (const p of paths) {
    const dir = join(repo, p.split('/').slice(0, -1).join('/'));
    if (p.includes('/')) await mkdir(dir, { recursive: true });
    await writeFile(join(repo, p), '# x');
  }
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'add docs');
  return repo;
}

describe('documentRecency survives real paths and real corpus sizes', () => {
  it('★★★ paths with spaces and non-ASCII are dated, not silently dropped', async () => {
    // ⛔ These are exactly the paths git quotes on output. Under line-splitting they came back as
    // `"docs/pl\305\274.md"` — a token matching no document — and the caller saw UNKNOWN for a
    // file that is tracked and dated.
    const paths = ['docs/a doc with spaces.md', 'docs/płótno.md', 'docs/ünïcode.md', 'plain.md'];
    await repoWith(paths);
    const m = documentRecency(repo, paths);
    expect(m.size, 'every tracked path is dated').toBe(paths.length);
    for (const p of paths) {
      expect(m.get(p), `${p} must carry a date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  }, 60_000);

  it('★★★ a population larger than one batch is fully dated', async () => {
    // The batch size is 150. This crosses it, so a bug that dated only the first batch — or that
    // threw on an oversized argv — shows as a partial map rather than passing by being small.
    const paths = Array.from({ length: 210 }, (_, i) => `docs/d${String(i).padStart(3, '0')}.md`);
    await repoWith(paths);
    const m = documentRecency(repo, paths);
    expect(m.size, 'both batches contributed').toBe(210);
    expect(m.get('docs/d000.md')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(m.get('docs/d209.md'), 'including the last batch').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 120_000);

  // ⛔ WHAT THIS FILE DOES NOT PROVE, MEASURED RATHER THAN ASSUMED. Raising BATCH from 150 to
  // 100000 — disabling batching entirely — leaves all five tests GREEN. 210 short paths fit inside
  // one argv on this host, so the test above proves the multi-batch TRAVERSAL is correct and proves
  // nothing about the argv limit the batching exists for. Demonstrating that needs a corpus large
  // enough to overflow the host command line (~2000 paths on Windows), which is a slow test for a
  // failure mode with a cheap, obviously-correct guard.
  //
  // ⇒ Stated here rather than left for someone to infer from a green suite. The batching is
  // REASONED, not covered — and a reader deciding whether to remove it should know that the tests
  // will not stop them.

  it('★★★ a filename with a LEADING SPACE keeps its byte — dev executed this against a8f1337', async () => {
    // ⛔⛔ THE WITNESS THAT KILLED `.trim()`. I removed git's structural newline with a blunt trim,
    // which also removed leading and trailing whitespace BELONGING TO THE FILENAME.
    // the reviewer committed a tracked file named exactly ` leading.md` and ran the function:
    //
    //     asked   [" leading.md"]
    //     keys    ["leading.md"]      <- an unrequested key
    //     missing [" leading.md"]     <- the requested path, UNKNOWN
    //
    // ★ The map filled with a wrong key while the real path went undated — the exact class the
    // "ONLY paths asked about" assertion below claims to prevent. That test passed throughout,
    // because it used friendly names. A contract asserted only over easy inputs is a contract
    // asserted nowhere.
    const paths = [' leading.md', 'trailing .md', 'plain.md'];
    await repoWith(paths);
    const m = documentRecency(repo, paths);
    expect([...m.keys()].sort(), 'every byte of the name survives the transport').toEqual(paths.slice().sort());
    expect(m.get(' leading.md'), 'the leading space is part of the name').toBeTruthy();
  }, 60_000);

  it('★★★ a decoded key nobody asked for is REFUSED, not stored', async () => {
    // ⛔ THE EXECUTABLE MEANING of "only paths asked about" — a population guard in the parser, not
    // an assertion over friendly fixtures. Both transport bugs presented the same way: a filled map
    // that looked like success. A key nobody requested is a parse failure wearing a result.
    const all = ['docs/asked.md', 'docs/not-asked.md'];
    await repoWith(all);
    const m = documentRecency(repo, ['docs/asked.md']);
    expect([...m.keys()], 'the sibling touched by the same commit is not adopted')
      .toEqual(['docs/asked.md']);
  }, 60_000);

  it('★★★ the map contains ONLY paths that were asked about', async () => {
    // ⛔ THE ASSERTION THAT CAUGHT THE NEWLINE BUG, and a size check alone would not have: the map
    // held MORE keys than inputs. "It returned data" is not "it returned the right data".
    const paths = ['docs/a.md', 'docs/b.md'];
    await repoWith([...paths, 'docs/unasked.md']);
    const m = documentRecency(repo, paths);
    expect([...m.keys()].sort()).toEqual(paths.sort());
  }, 60_000);

  it('★★★ an untracked or absent path is UNKNOWN, never dated', async () => {
    // ⚠ "Cannot tell" must not resolve to a value. The ranking sorts unknown recency LAST rather
    // than as "oldest", and that is only sound if absence really means absence here.
    await repoWith(['tracked.md']);
    await writeFile(join(repo, 'untracked.md'), '# x');
    const m = documentRecency(repo, ['tracked.md', 'untracked.md', 'never-existed.md']);
    expect(m.get('tracked.md'), 'POSITIVE CONTROL: the instrument does date files').toBeTruthy();
    expect(m.has('untracked.md'), 'present on disk, absent from history').toBe(false);
    expect(m.has('never-existed.md')).toBe(false);
  }, 60_000);

  it('★★★ a repo with no git history yields an empty map rather than throwing', async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-recency-nogit-'));
    await writeFile(join(repo, 'x.md'), '# x');
    expect(documentRecency(repo, ['x.md']).size, 'a missing signal must never break the brief').toBe(0);
  }, 30_000);
});
