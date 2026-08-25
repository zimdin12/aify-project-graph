// A CAUSE MUST BE ATTRIBUTED TO WHOEVER ACTUALLY CAUSED IT.
//
// ⛔ REGRESSION I INTRODUCED, caught in field testing the same day (2026-08-19, build 754223f).
// The original defect: `kind !== 'code'` counted `kind="all"` — the WIDEST setting, which
// excludes nothing — as an active narrowing filter, so taking the message's own advice
// produced a new line blaming filters. My fix changed it to `kind && kind !== 'all'`, which
// FLIPPED THE POLARITY instead of correcting it: `kind` has a PARAMETER DEFAULT of 'code', so
// a bare call with no arguments at all now reported "filters are active (type/file/kind)".
//
// ★ And my heading change made it land harder. "May be narrowing:" means "this could be your
// cause", so the false claim was promoted from a clause to a hypothesis. A fix that makes the
// wrong statement more confident is worse than the defect it replaced.
//
// ⇒ THE DISTINCTION THE CODE NEEDS IS CALLER-SUPPLIED vs VERB-DEFAULT, not a value test on
// `kind`. Both are real narrowings in SQL — the default genuinely excludes Document, Directory,
// Config and External — so neither should be silent. They must be ATTRIBUTED differently,
// because a reader can only act on the one they chose. Same shape as separating "declared
// type" from "populated type" in whereis: one word covering two facts.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphSearch } from '../../../mcp/stdio/query/verbs/search.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

async function repo() {
  const r = await mkdtemp(join(tmpdir(), 'apg-fa-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
    extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
          VALUES ('a','Function','somethingElse','src/a.js',1,2,'javascript',1,'{}')`);
  db.close();
  return r;
}

const ABSENT = 'ZZZ_no_such_symbol_98765';

describe('graph_search zero-result cause attribution', () => {
  it('★★★ a bare call does not blame filters the caller never passed', async () => {
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT });
    expect(out, 'no type=, no file=, no kind= — nothing the caller set can be narrowing')
      .not.toMatch(/filters are active/i);
  }, 20_000);

  it('★★★ but a bare call DOES disclose the default it applied to itself', async () => {
    // The default is a real SQL narrowing (Document/Directory/Config/External excluded). Going
    // silent about it would trade a misattributed cause for a hidden one.
    // ⚠ The first version of this assertion matched /kind="all"/ and PASSED against the unfixed
    // code — because the pre-existing "Next:" line already contains that string. It was testing
    // the presence of a suggestion, not the presence of an attribution. Match the attribution.
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT });
    expect(out, 'the reader must learn a DEFAULT excluded docs/configs, not that they set one')
      .toMatch(/default/i);
  }, 20_000);

  it('★★★ kind="all" is the WIDEST setting and must not be reported as narrowing', async () => {
    // The original defect, pinned so the correction cannot swing back through it.
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT, kind: 'all' });
    expect(out, 'passing the widest kind excludes nothing').not.toMatch(/filters are active/i);
    expect(out, 'no default was applied, so there is nothing to attribute to one')
      .not.toMatch(/default/i);
    expect(out, 'and re-suggesting the setting they already passed is a non-terminating remedy')
      .not.toMatch(/Next: graph_search\(query="[^"]*", kind="all"\)/);
  }, 20_000);

  it('★★★ a caller-supplied type IS reported as narrowing', async () => {
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT, type: 'Function' });
    expect(out, 'the caller chose this one and can act on it').toMatch(/filters are active/i);
  }, 20_000);

  it('★★★ a caller-supplied file IS reported as narrowing', async () => {
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT, file: 'src/' });
    expect(out).toMatch(/filters are active/i);
  }, 20_000);

  it('★★★ "Ruled out" holds only causes actually ruled OUT', async () => {
    // An active filter is a CANDIDATE cause. Filing it under a heading that means "verified not
    // to be the cause" is the same class as every printed basis that did not match its
    // computation this month.
    repoRoot = await repo();
    const out = await graphSearch({ repoRoot, query: ABSENT, type: 'Function' });
    const ruledOut = (out.match(/Ruled out:[^.]*\./) || [''])[0];
    expect(ruledOut, 'a possible cause must not appear under Ruled out').not.toMatch(/filters/i);
  }, 20_000);
});
