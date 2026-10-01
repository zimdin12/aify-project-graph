// ⛔⛔ AN ANCHOR THAT NAMES TWO SYMBOLS IS REFUSED WITH BOTH, AND PRESENCE CAN BE ASKED OF A COMMIT.
//
// 1. AMBIGUITY. The resolver took the FIRST symbol whose label or qualified name matched. Two methods called `run`
//    in two classes of one file are two symbols, and an anchor naming `run` was stamped, swept and reconfirmed
//    against whichever the extractor emitted first, with nothing saying a choice had been made. The dashboard's
//    resolve call (DESIGN-GRAPHS.md:216) attaches the candidates to the node as a fix hint, and asked for exactly
//    this case: "taking the first match silently is exactly the case the hint exists for". So an ambiguous anchor
//    is now refused as `unwatched: ambiguous_anchor`, and the candidates travel BESIDE the row, not in it, so a
//    sweep posts only fields the service already reads.
//
// 2. PRESENCE AT A COMMIT. `gone` was decided by listing the working tree. Queued calls read the commit (`git show
//    <head>:<path>`, amendment 2), so the tree is the wrong place to ask. Presence is now an injectable instrument;
//    the listing stays the default, so a sweep is unchanged.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveAnchor } from '../../../scripts/lib/anchor-resolver.mjs';

const COMPLETE = Object.freeze({ parseHadError: false, depthCapFired: false, depthCap: 80 });
let repoRoot;
beforeEach(async () => {
  repoRoot = await mkdtemp(join(tmpdir(), 'apg-ambiguity-'));
  await mkdir(join(repoRoot, 'src'), { recursive: true });
  await writeFile(join(repoRoot, 'src', 'two.js'), 'class A { run() {} }\nclass B { run() {} }\n');
});
afterEach(async () => {
  if (repoRoot) { try { await rm(repoRoot, { recursive: true, force: true }); } catch { /* win lock */ } }
  repoRoot = undefined;
});

const fn = (label, qname, line) => ({ type: 'Function', label, start_line: line, structural_fp: `S-${qname}`, dependency_fp: `D-${qname}`, extra: { qname } });
const deps = (symbols, over = {}) => ({
  languageOf: (rel) => { if (rel.endsWith('.js')) return { name: 'javascript' }; throw new Error('none'); },
  isDocument: () => false,
  readSource: () => 'source',
  extract: () => ({ nodes: [{ type: 'File', label: 'two.js' }, ...symbols], coverage: COMPLETE }),
  fileFingerprint: () => 'FILE-FP',
  docReferences: () => [],
  ...over,
});
const TWO_RUNS = [fn('run', 'A.run', 1), fn('run', 'B.run', 2)];
const resolve = (name, symbols, over) => resolveAnchor({
  repoRoot, deps: deps(symbols, over), item: { watchId: 'w', anchor: { path: 'src/two.js', name, kind: 'symbol' }, stamp: null },
});

describe('an anchor that names more than one symbol', () => {
  it('★★★ is refused as ambiguous_anchor, with every candidate beside the row', () => {
    const out = resolve('run', TWO_RUNS);
    expect(out.kind).toBe('unwatched');
    expect(out.row.reasonCode).toBe('ambiguous_anchor');
    expect(out.candidates).toEqual([
      { name: 'run', qname: 'A.run', line: 1 },
      { name: 'run', qname: 'B.run', line: 2 },
    ]);
  });

  it('★★★ the posted row carries only what the service reads; the candidates are not in it', () => {
    expect(Object.keys(resolve('run', TWO_RUNS).row).sort()).toEqual(['reason', 'reasonCode', 'watchId']);
  });

  it('★★★ CONTROL: the qualified name picks one, and a lone label still resolves', () => {
    // Without these, a resolver that refused every symbol anchor would pass the two tests above.
    const byQname = resolve('B.run', TWO_RUNS);
    expect(byQname.kind).toBe('result');
    expect(byQname.row.status).toBe('restamp');
    const lone = resolve('run', [fn('run', 'A.run', 1)]);
    expect(lone.kind).toBe('result');
  });
});

describe('presence can be asked of something other than the working tree', () => {
  it('★★★ an injected isPresent decides gone, and the evidence names where it looked', () => {
    // The file IS on disk here. Only the injected instrument says it is absent, so a `gone` proves the injection
    // was used rather than the listing.
    const out = resolve('run', TWO_RUNS, { isPresent: () => false, where: 'commit abc123' });
    expect(out.kind).toBe('result');
    expect(out.row.status).toBe('gone');
    expect(out.row.evidence).toContain('commit abc123');
  });

  it('★★★ CONTROL: an injected isPresent that says present is believed even with no file on disk', () => {
    const out = resolve('B.run', TWO_RUNS, { isPresent: () => true, where: 'commit abc123' });
    expect(out.kind).toBe('result');
    expect(out.row.status).toBe('restamp');
    const gonePath = resolveAnchor({
      repoRoot, deps: deps(TWO_RUNS, { isPresent: () => true, where: 'commit abc123' }),
      item: { watchId: 'w', anchor: { path: 'src/not-on-disk.js', name: 'B.run', kind: 'symbol' }, stamp: null },
    });
    expect(gonePath.row.status, 'the listing would have said gone; the injection said present').toBe('restamp');
  });
});
