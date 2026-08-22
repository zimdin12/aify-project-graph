// ⛔ ONE GIT OBSERVATION PER READ, SO DISAGREEMENT IS UNCONSTRUCTIBLE RATHER THAN UNLIKELY.
//
// THE FIELD REPORT THIS CLOSES (2026-07-27): on a tree with 0 tracked modifications and 592
// untracked files, one verb printed "592 dirty" and another "4 dirty" — same tree, same commit.
// The reader could not tell which was lying, and two numbers for one question is worse than either
// number alone.
//
// The tracked/untracked half of that was fixed by routing counts through one helper. THE OTHER
// HALF SURVIVED: four verbs ran `git status` a SECOND time, milliseconds after inspectReadFreshness
// had already run it and printed a warning about the result. Two queries at two moments cannot be
// made to agree by care — a commit, a checkout or an editor save between them is enough. So the
// second query is gone and the four verbs read the observation they were already handed.
//
// ⚠ WHAT THIS FILE CANNOT DO. It cannot prove the two queries disagreed in the field; that needs a
// race nobody can schedule. It proves the weaker, checkable thing: there is now only ONE query, so
// there is nothing left to disagree with.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectReadFreshness } from '../../../mcp/stdio/query/verbs/read_freshness.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';

const SEAM_VERBS = ['change_plan', 'consequences', 'pull', 'explain_diff'];
const srcOf = (v) => readFileSync(`mcp/stdio/query/verbs/${v}.js`, 'utf8');

describe('the second git query is gone', () => {
  it('★★★⛔ no seam verb calls getDirtyFiles at all any more', () => {
    // Substring needles, not regexes: a regex here would need escaping, and this repo has already
    // shipped one guard whose `\\b` was eaten down to a literal backspace byte and matched nothing.
    for (const v of SEAM_VERBS) {
      expect(srcOf(v).includes('getDirtyFiles'),
        `${v} must read freshness.dirtyFiles, not run its own git query`).toBe(false);
    }
  });

  it('★★★ POSITIVE CONTROL: the needle catches the call if it returns', () => {
    // ⛔ Without this, the four negatives above are satisfied by a needle that can never match —
    // which is exactly what a mangled guard looks like from the outside.
    expect('const d = await getDirtyFiles(repoRoot);'.includes('getDirtyFiles')).toBe(true);
  });

  it('★★★ and each of them does consume the shared observation', () => {
    // ⛔ THE OTHER HALF OF THE PAIR. "Does not call getDirtyFiles" is also true of a verb that
    // stopped looking at the working tree entirely — which would delete the feature rather than
    // fix it. This asserts the replacement is wired, not merely that the old call is absent.
    for (const v of SEAM_VERBS) {
      expect(srcOf(v).includes('freshness.dirtyFiles'),
        `${v} must actually read the shared observation`).toBe(true);
    }
  });
});

describe('the unknown reaches the machine reader, not only the prose', () => {
  it('★★★⛔ the structured seam blocks carry an unobserved marker; the text verbs do not', () => {
    // ⚠ THIS SPLIT IS THE POINT, and getting it backwards would be an over-correction. graph_pull
    // and graph_consequences emit `dirty_overlap` as DATA — an agent reads it without ever seeing
    // the warning line. graph_change_plan and graph_explain_diff render prose, where the freshness
    // warning already is the disclosure, so a second machine flag there would have no consumer.
    for (const v of ['pull', 'consequences']) {
      expect(srcOf(v).includes('unobserved: true'),
        `${v} emits structured seam data and must mark it`).toBe(true);
    }
    for (const v of ['change_plan', 'explain_diff']) {
      expect(srcOf(v).includes('dirtyFilesKnown = freshness'),
        `${v} renders text — an unused flag whose comment claims it works is how a defect hides`)
        .toBe(false);
    }
  });

  it('★★★⛔ summarizeDirtyOverlapForNode has NO default for dirtyFilesKnown', () => {
    // ⛔ I WROTE `= true` FIRST. That is a fail-open default: a call site added later and missed
    // would silently certify a tree nobody read — the same shape as every other defect in this
    // sweep, reintroduced by the fix for it. With no default, an omission is `undefined`, which is
    // falsy, which reports UNOBSERVED. The omission fails toward doubt.
    const s = srcOf('pull');
    expect(s.includes('dirtyFilesKnown = true'), 'no fail-open default').toBe(false);
    expect(s.includes('function summarizeDirtyOverlapForNode({ kind, value, features, dirtyFiles, dirtyFilesKnown })'),
      'the parameter is present and undefaulted').toBe(true);
    // Every call site passes it. A count, so dropping one is not silent.
    expect((s.match(/dirtyFilesKnown,/g) ?? []).length,
      'all four dirty_overlap call sites supply the measured value').toBe(4);
  });
});

// The behavioural half: the flag is real, and it flips.
let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

describe('dirtyFilesKnown is measured, not assumed', () => {
  it('★★★⛔ true on a readable tree, false when git cannot be read', async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-one-obs-'));
    await mkdir(join(repoRoot, '.aify-graph'), { recursive: true });
    execFileSync('git', ['-C', repoRoot, 'init', '-q'], { stdio: 'ignore' });
    execFileSync('git', ['-C', repoRoot, '-c', 'user.email=t@t', '-c', 'user.name=t',
      'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
    const commit = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    await writeFile(join(repoRoot, '.aify-graph', 'manifest.json'), JSON.stringify({
      commit, indexedAt: new Date().toISOString(), nodes: 1, edges: 0, schemaVersion: 4,
      extractorVersion: '0.1.0', status: 'ok', dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
    }));
    // ⛔ A REAL graph.sqlite, AND MY FIRST FIXTURE HAD NONE. Without it inspectReadFreshness takes
    // the `!existsSync(dbPath)` exit, which does no git work at all and honestly reports
    // dirtyFilesKnown:false — so the test failed against CORRECT code. The fixture was measuring a
    // different path from the one it named, which is the derived-expectation trap: I would have
    // "fixed" working code to satisfy a scenario I had not actually constructed.
    const db = openDb(join(repoRoot, '.aify-graph', 'graph.sqlite'));
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('a','Function','f','src/a.js',1,2,'javascript',1,'{}')`);
    db.close();

    const healthy = await inspectReadFreshness({ repoRoot, verbName: 'graph_test' });
    expect(healthy.dirtyFilesKnown, 'a readable tree is KNOWN').toBe(true);
    expect(healthy.dirtyFiles).toEqual([]);

    // ⛔ Both arms on the same repo. An assertion that only runs on the broken world is satisfied
    // by a flag that is false always — which would mark every healthy answer unobserved.
    await rm(join(repoRoot, '.git'), { recursive: true, force: true, maxRetries: 5 });
    const blind = await inspectReadFreshness({ repoRoot, verbName: 'graph_test' });
    expect(blind.dirtyFilesKnown, 'an unreadable tree is NOT known').toBe(false);
    expect(blind.dirtyFiles, 'and the list is still empty — which is exactly why the flag is needed')
      .toEqual([]);
  }, 20_000);
});
