// ⛔ THE ONLY HOOK CONTENT THAT SURVIVED ITS FIRE-RATE MEASUREMENT.
//
// Measured against 120 real commits, 83 of which touched a source file — the population a
// PostToolUse hook would see:
//
//     A  "here are the callers of what you just edited"   71/83 = 85.5%, mean 15 files   DEAD
//     B  "you deleted something that still has callers"    4/83 =  4.8% (upper bound)    THIS
//
// Rule A is not a tuning problem: "X has callers" is true of almost every edit in a connected
// codebase, so it cannot CONTRADICT anything. Rule B can only fire when the editor has evidently
// concluded something the graph disagrees with.
//
// ⚠ SO MOST OF THIS FILE IS ABOUT WHAT MUST **NOT** FIRE. A hook's value is destroyed by its false
// positives, not improved by its true ones, and the 4.8% only holds if each of these stays silent.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../../mcp/stdio/storage/db.js';
import { removedDeclarations, deletedWithCallers } from '../../../mcp/stdio/analysis/deleted-with-callers.js';

let dir;
let db;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-delcall-'));
  db = openDb(join(dir, 'g.sqlite'));
  const node = (id, type, label, file) => db.run(
    `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
     VALUES ('${id}','${type}','${label}','${file}',1,1,'javascript',1,'{}')`);
  node('t', 'Function', 'target', 'src/lib.js');
  node('c1', 'Function', 'callerOne', 'src/other.js');
  node('c2', 'Function', 'callerTwo', 'src/lib.js');       // SAME file as the target
  node('lonely', 'Function', 'lonely', 'src/lib.js');       // nothing calls it
  // ⛔ LSP_VERIFIED, because the rule refuses heuristic edges. See the collision test below.
  db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
          VALUES ('c1','t','CALLS',1,'LSP_VERIFIED','test')`);
  db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
          VALUES ('c2','t','CALLS',1,'LSP_VERIFIED','test')`);
});
afterEach(() => { try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });

const DEL_TARGET = '--- a/src/lib.js\n+++ b/src/lib.js\n-export function target() {\n-  return 1;\n-}\n';

describe('removedDeclarations — a modified declaration is not a deleted one', () => {
  it('★★★⛔ THE FACTOR-OF-THREE ERROR: a -/+ pair on the same name deletes nothing', () => {
    // ⛔ The first fire-rate measurement counted every `-const X` line and reported 15.7% instead
    // of 4.8%. Bumping `EXTRACTOR_VERSION` from '0.3.0' to '0.4.0' registered as deleting a symbol
    // that has callers. 15.7% reads as "too noisy to ship" — the broken instrument would have
    // killed this rule before it existed.
    const modified = "-const EXTRACTOR_VERSION = '0.3.0';\n+const EXTRACTOR_VERSION = '0.4.0';\n";
    expect(removedDeclarations(modified), 'a value change is not a removal').toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: a real removal IS reported, and its export status carried', () => {
    // ⛔ Without this, the assertion above is satisfied by a parser that finds nothing at all.
    expect(removedDeclarations('-export function gone() {}\n')).toEqual([{ name: 'gone', exported: true }]);
    expect(removedDeclarations('-function quiet() {}\n')).toEqual([{ name: 'quiet', exported: false }]);
  });

  it('★★★ an ADDED declaration alone is never a removal', () => {
    // The `-` anchor matters: matching declaration text anywhere in a diff would fire on every
    // addition, which is the exact opposite of the intent.
    expect(removedDeclarations('+export function brandNew() {}\n')).toEqual([]);
  });

  it('★★★ a name removed twice is reported once, and exported wins', () => {
    const d = removedDeclarations('-const dup = 1;\n-export const dup = 2;\n');
    expect(d).toEqual([{ name: 'dup', exported: true }]);
  });
});

describe('it fires on the contradiction', () => {
  it('★★★⛔ deleting an exported symbol with an OUTSIDE caller fires', () => {
    const f = deletedWithCallers({ db, diff: DEL_TARGET, editedFiles: ['src/lib.js'] });
    expect(f.length).toBe(1);
    expect(f[0].symbol).toBe('target');
    expect(f[0].callers.map((c) => c.file)).toEqual(['src/other.js']);
    expect(f[0].message, 'the message states the contradiction').toMatch(/You removed `target`/);
    expect(f[0].message, 'and names the surface the claim rests on').toMatch(/graph's last index/);
    expect(f[0].message).toMatch(/src\/other\.js/);
  });
});

describe('⛔ what it must NOT fire on — this is where the 4.8% lives', () => {
  it('★★★ a deleted symbol with NO callers is silent', () => {
    const f = deletedWithCallers({ db, diff: '-export function lonely() {}\n', editedFiles: ['src/lib.js'] });
    expect(f, 'removing dead code is the common case and must be silent').toEqual([]);
  });

  it('★★★⛔ callers INSIDE the edited files are not a contradiction', () => {
    // ⚠ Someone deleting a helper and its only use in one edit is doing exactly what they meant.
    // `callerTwo` lives in src/lib.js and calls `target`; editing that file excludes it. If this
    // fired, every ordinary refactor would trip the hook and it would be muted within a day.
    const f = deletedWithCallers({ db, diff: DEL_TARGET, editedFiles: ['src/lib.js', 'src/other.js'] });
    expect(f, 'every caller was in a file the author was editing').toEqual([]);
  });

  it('★★★⛔ a MODIFIED exported declaration is silent even though it has callers', () => {
    // The end-to-end form of the factor-of-three error: `target` has a real outside caller, so if
    // the -/+ pair were read as a deletion this WOULD fire, and wrongly.
    const modified = '-export function target() { return 1; }\n+export function target() { return 2; }\n';
    expect(deletedWithCallers({ db, diff: modified, editedFiles: ['src/lib.js'] })).toEqual([]);
  });

  it('★★★ a non-exported removal is silent by default', () => {
    // Local helpers churn constantly. `exportedOnly` is the default because an exported name is a
    // contract and a local one is an implementation detail.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('p','Function','privateHelper','src/lib.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
            VALUES ('c1','p','CALLS',1,'LSP_VERIFIED','test')`);
    // ⚠ THE `+++ b/` HEADER IS REQUIRED, and my first version of this fixture omitted it — so the
    // test failed against correct code. Without a file there is nothing to resolve identity
    // against, and the rule stays silent rather than falling back to a bare label match. That
    // fallback is the whole defect this file exists to prevent.
    const diff = '--- a/src/lib.js\n+++ b/src/lib.js\n-function privateHelper() {}\n';
    expect(deletedWithCallers({ db, diff, editedFiles: ['src/lib.js'] })).toEqual([]);
    // POSITIVE CONTROL: the same removal DOES fire when the caller explicitly widens, so the
    // silence above is a policy and not a broken lookup.
    expect(deletedWithCallers({ db, diff, editedFiles: ['src/lib.js'], exportedOnly: false }).length).toBe(1);
  });

  it('★★★⛔ a diff with NO file header resolves to nothing — it does not fall back to the label', () => {
    // ⛔ FAIL CLOSED. The file is what turns a name into an identity; without it the only available
    // move is a bare-label match, which reported 193 callers for `has` on the real graph. Silence
    // is the correct answer to "which declaration did you mean".
    expect(deletedWithCallers({ db, diff: '-export function target() {}\n', editedFiles: [] }),
      'no header, no identity, no claim').toEqual([]);
  });

  it('★★★ an empty or absent diff is silent rather than throwing', () => {
    for (const d of ['', null, undefined]) {
      expect(deletedWithCallers({ db, diff: d, editedFiles: [] })).toEqual([]);
    }
  });
});

// ⛔⛔ THE MEASUREMENT THAT NEARLY SHIPPED A LABEL-COLLISION HOOK.
//
// Resolving the deleted symbol by identity was not enough, because the EDGES are resolved by label
// too. Against the real graph, after that fix: deleting `writeFile` — declared in a test file,
// spelled like Node's fs function — reported SEVENTY callers. Deleting `has` reported 193, because
// every `x.has(y)` in the corpus had been attributed to one `has` node by the extractor.
//
//     whole-graph CALLS/REFERENCES/IMPORTS provenance:
//         EXTRACTED     12024   tree-sitter heuristic, resolved by label
//         AMBIGUOUS      1028
//         LSP_VERIFIED     19   compiler-resolved
//
// ⇒ A hook is UNBIDDEN and cannot be cheaply checked, so it may only claim what its evidence
// supports. Shipping this on EXTRACTED edges is the defect this repo deleted a doc rule for the
// same week: existence in the index is not evidence of reference.
describe('⛔ heuristic edges cannot support an unbidden claim', () => {
  it('★★★⛔ an EXTRACTED caller does NOT fire the hook', () => {
    // The `has` case, in miniature: a plausible-looking edge that is really a name collision.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('h','Function','has','src/lib.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('hc','Function','usesAMap','src/elsewhere.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
            VALUES ('hc','h','CALLS',1,'EXTRACTED','javascript')`);
    const diff = '--- a/src/lib.js\n+++ b/src/lib.js\n-export function has() {}\n';
    expect(deletedWithCallers({ db, diff, editedFiles: ['src/lib.js'] }),
      'a heuristic label match is not a contradiction').toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: the same shape WITH a verified edge does fire', () => {
    // ⛔ Without this, the refusal above is satisfied by a rule that never fires at all — which,
    // given only 19 verified edges exist in the real graph, is very close to true and must still
    // be distinguishable from broken.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('h','Function','has','src/lib.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('hc','Function','realCaller','src/elsewhere.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
            VALUES ('hc','h','CALLS',1,'LSP_VERIFIED','clangd')`);
    const diff = '--- a/src/lib.js\n+++ b/src/lib.js\n-export function has() {}\n';
    const f = deletedWithCallers({ db, diff, editedFiles: ['src/lib.js'] });
    expect(f.length, 'compiler-resolved evidence can support the claim').toBe(1);
    expect(f[0].callers[0].file).toBe('src/elsewhere.js');
  });

  it('★★★⛔ an AMBIGUOUS declaration resolves to nothing rather than to a guess', () => {
    // Two declarations of the same name in one file. Picking one would be the first-wins rule that
    // killed the legacy mentions extractor.
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('d1','Function','dup','src/dup.js',1,1,'javascript',1,'{}')`);
    db.run(`INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
            VALUES ('d2','Class','dup','src/dup.js',9,9,'javascript',1,'{}')`);
    db.run(`INSERT INTO edges (from_id,to_id,relation,confidence,provenance,extractor)
            VALUES ('c1','d1','CALLS',1,'LSP_VERIFIED','test')`);
    const diff = '--- a/src/dup.js\n+++ b/src/dup.js\n-export function dup() {}\n';
    expect(deletedWithCallers({ db, diff, editedFiles: ['src/dup.js'] })).toEqual([]);
  });
});
