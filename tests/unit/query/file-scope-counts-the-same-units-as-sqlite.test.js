// ⛔ I FIXED A FALSE ABSENCE AND INTRODUCED A FALSE ABSENCE.
//
// 5d152a1a moved the `file` scope into SQL so the fetch cap could not discard an in-scope caller
// before the filter ran. The predicate it wrote was
//
//     AND substr(n.file_path, 1, $fileLen) = $filePrefix     with   fileLen: file.length
//
// and those two lengths are measured in DIFFERENT COORDINATE SYSTEMS. JavaScript's `String.length`
// counts UTF-16 code units; SQLite's `substr` counts Unicode characters. Every path made of BMP
// characters agrees, so the whole suite agreed. A path containing an astral character does not:
// `src/🧪/` is 8 units to JavaScript and 7 characters to SQLite, so the comparison takes 8
// characters from the path, compares them against a 7-character prefix, and can never match.
//
// The verb then answers `NO CALLERS from "src/🧪/"` — which is the exact output the commit that
// introduced this was written to eliminate, and the one this file's neighbours call the most
// dangerous thing it can say.
//
// ⭐ THE REPAIR IS TO STOP MIXING UNITS, NOT TO CONVERT BETWEEN THEM. `length($filePrefix)` is
// evaluated by SQLite, so both operands are in SQLite's units by construction and no future path
// shape can pull them apart. LIKE would also work and is deliberately NOT used: a path may contain
// `%` or `_`, and this comparison must stay literal.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { graphCallers } from '../../../mcp/stdio/query/verbs/callers.js';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

// The discriminator, written down rather than computed, so the fixture and the subject can disagree.
const ASTRAL_DIR = 'src/\u{1F9EA}/';           // "src/🧪/"
const ASTRAL_FILE = `${ASTRAL_DIR}a.js`;

let repoRoot;
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

/** One caller in an astral-named directory, one in a plain directory, both calling `target`. */
async function repoWithAnAstralPath() {
  const r = await mkdtemp(join(tmpdir(), 'apg-astral-'));
  await mkdir(join(r, '.aify-graph'), { recursive: true });
  execFileSync('git', ['-C', r, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', r, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '--allow-empty', '-qm', 'i'], { stdio: 'ignore' });
  const commit = execFileSync('git', ['-C', r, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  await writeFile(join(r, '.aify-graph', 'manifest.json'), JSON.stringify({
    commit, indexedAt: new Date().toISOString(), nodes: 3, edges: 2,
    schemaVersion: 4, extractorVersion: '0.1.0', status: 'ok',
    dirtyFiles: [], dirtyEdges: [], dirtyEdgeCount: 0,
  }));
  const db = openDb(join(r, '.aify-graph', 'graph.sqlite'));
  const node = (id, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ($id,'Function',$label,$file,1,2,'javascript',1,'{}')`, { id, label, file });
  const edge = (from) => db.run(
    `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
     VALUES ($from,'t','CALLS','x.js',1,0.9,'LSP_VERIFIED','test')`, { from });

  node('t', 'target', 'src/core/target.js');
  node('a', 'astralCaller', ASTRAL_FILE);
  node('p', 'plainCaller', 'src/plain/p.js');
  edge('a');
  edge('p');
  db.close();
  return r;
}

describe('a file scope compares lengths in ONE coordinate system', () => {
  it('★★★ THE REAL CASE: a caller under an astral-named directory is reachable by that scope', async () => {
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: ASTRAL_DIR }));

    expectAbsentWithLiveMatcher(
      /NO CALLERS from/,
      { forbidden: `NO CALLERS from "${ASTRAL_DIR}"`, allowed: 'NO CALLERS for "target"' },
      out,
      'an astral path must not be reported as an empty scope',
    );
    expect(out).toMatch(/astralCaller/);
  });

  it('★★★ AND AT depth>1, which builds a different query with its own predicate', async () => {
    // The two SQL branches carry the comparison separately. Fixing one and not the other is the
    // "both verbs" miss this repository keeps paying for, inside a single function.
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: ASTRAL_DIR, depth: 2 }));

    expect(out).toMatch(/astralCaller/);
  });

  it('★★★ THE DISCRIMINATING CONTROL: a scope with genuinely nothing in it still says so', async () => {
    // Without this, "no false absence" is satisfied by a verb that stopped filtering entirely.
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/nowhere/' }));

    expect(out).toMatch(/NO CALLERS from/);
  });

  it('★★★ AND THE SCOPE STILL EXCLUDES: the plain caller is not swept into the astral scope', async () => {
    // The other half of discrimination. A predicate that matched everything would pass the first
    // two tests and be useless.
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: ASTRAL_DIR }));

    expectAbsentWithLiveMatcher(
      /plainCaller/,
      { forbidden: 'EDGE plainCaller->target CALLS', allowed: 'EDGE astralCaller->target CALLS' },
      out,
      'a scoped query must not return callers from outside the scope',
    );
  });

  it('★★ a BMP path is unaffected — the repair must not change what already worked', async () => {
    // The positive control on the ordinary path, which is every path this repository actually has.
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/plain/' }));

    expect(out).toMatch(/plainCaller/);
  });

  it('★★ a path containing % or _ stays LITERAL — this is why the predicate is not LIKE', async () => {
    // Guarding the reason the comparison was written this way in the first place, so a future
    // "simplify it to LIKE" cannot pass silently.
    repoRoot = await repoWithAnAstralPath();
    const out = String(await graphCallers({ repoRoot, symbol: 'target', file: 'src/%/' }));

    expect(out).toMatch(/NO CALLERS from/);
  });
});
