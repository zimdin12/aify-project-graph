// ⛔ A DELETE SCOPED BY AN EXTRACTOR PREFIX IS SAFE ONLY WHILE THAT PREFIX HAS ONE WRITER.
//
// `cpp-clangd#` was single-writer by convention, delete-scoped by prefix, and carried a comment
// saying so. Then a second producer wrote the same string, and the invalidation that "only touches
// its own edges" became provider-blind — a C++ collect entitled to delete TypeScript evidence. The
// comment never stopped being true-looking; it stopped being true.
//
// ef-manager ran the search that rule implies and found three more deletes with the same
// structure, all currently sound for the same reason cpp-clangd# was sound until it was not:
//
//     analysis/doc-links.js         DELETE ... relation='LINKS_TO' AND extractor LIKE 'doc_link:%'
//     analysis/doc-refs.js          DELETE ... relation='MENTIONS' AND extractor LIKE 'doc_ref:%'
//     frameworks/virtual_overrides  DELETE ... extractor = VIRTUAL_OVERRIDE_EXTRACTOR
//
// Each says it in a comment — "so it never touches another extractor's edges", "the only owner
// that may delete them is this synthesizer" — and nothing enforces it. `doc_ref:` acquires the
// identical exposure the day a second doc-reference extractor is added, which is a thing that
// happens in this repo: rules 1 through 4 shipped in one night.
//
// ⚠ REPORTED AS LATENT. No second writer exists today, nothing has been lost, and this file
// asserts an invariant that currently HOLDS. Its value is entirely in the day it stops holding.
//
// ★ Modelled on `packet-authority-boundaries.test.js`, which asserts that exactly one module
// exports a tool entry — a claim about who may write a name, enforced rather than commented.
import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { detectDocLinks } from '../../mcp/stdio/analysis/doc-links.js';
import { openDb } from '../../mcp/stdio/storage/db.js';

const MCP = fileURLToPath(new URL('../../mcp', import.meta.url));
const SEP = String.fromCharCode(92);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js')) out.push(p);
  }
  return out;
}

// Comments are stripped, and the direction of that hole is deliberate: prose ABOUT a prefix (this
// file's own header, a changelog note) must not read as a second writer. The reverse — a real
// writer hidden in something shaped like a comment — is not reachable from a `//` line.
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');

const rel = (p) => p.slice(p.indexOf(`mcp${SEP}`)).split(SEP).join('/');
const filesContaining = (needle) => walk(MCP)
  .filter((f) => strip(readFileSync(f, 'utf8')).includes(needle))
  .map(rel);

// prefix -> the single module entitled to write it, and therefore to delete by it.
const OWNED_PREFIXES = {
  'doc_link:': 'mcp/stdio/analysis/doc-links.js',
  'doc_ref:': 'mcp/stdio/analysis/doc-refs.js',
  'virtual-overrides': 'mcp/stdio/ingest/frameworks/virtual_overrides.js',
};

describe('an extractor prefix used to scope a DELETE has exactly one writer', () => {
  it('★★★ THE INSTRUMENT WORKS — it finds a string that really is in several modules', () => {
    // ⛔ WITHOUT THIS THE WHOLE FILE IS VACUOUS. Every assertion below is of the form "no other
    // file contains X", which a scanner that finds nothing satisfies perfectly. A wrong zero here
    // agrees with what we expect, so nothing else would ever collide with it.
    const many = filesContaining('LSP_VERIFIED');
    expect(many.length, 'the scanner can find a widely-used literal').toBeGreaterThan(2);
    // ...and it discriminates: a string that is in no module at all comes back empty.
    expect(filesContaining('zzz-not-an-extractor-prefix-zzz')).toEqual([]);
  });

  for (const [prefix, owner] of Object.entries(OWNED_PREFIXES)) {
    it(`★★★ only ${owner} writes "${prefix}"`, () => {
      const hits = filesContaining(prefix);
      // Positive control per prefix: the owner must actually be found, or "no other file has it"
      // is true of a prefix nobody has.
      expect(hits, `the owner of "${prefix}" must contain it`).toContain(owner);
      expect(hits.filter((f) => f !== owner),
        `"${prefix}" scopes a DELETE in ${owner}. A second module writing this prefix makes that `
        + 'DELETE reach edges it never produced — the cpp-clangd# defect, exactly. If another '
        + 'module needs this label, import the constant and give the DELETE an owner-aware '
        + 'predicate first.').toEqual([]);
    });
  }
});

// ⚠ THE SCAN ABOVE CANNOT FAIL WHEN THE BEHAVIOUR BREAKS — it asserts on text. The suite's
// composition ratchet says so in as many words, and it is right: a text assertion "can fail when a
// line is reflowed" and stays green when a DELETE starts reaching further than it should.
//
// ⇒ So the invariant is ALSO exercised. The static scan catches the second writer that does not
// exist yet; the behavioural arm below catches a widened predicate today. Neither subsumes the
// other, which is why both are here rather than one being chosen.
describe('the DELETE itself spares edges it did not produce', () => {
  let root;
  afterEach(async () => {
    if (root) { try { await rm(root, { recursive: true, force: true }); } catch { /* win lock */ } }
    root = undefined;
  });

  it('★★★ detectDocLinks removes only doc_link: edges, leaving foreign LINKS_TO alone', async () => {
    root = await mkdtemp(join(tmpdir(), 'apg-owner-'));
    await mkdir(join(root, '.aify-graph'), { recursive: true });
    await writeFile(join(root, 'README.md'), '# hi' + String.fromCharCode(10));
    const db = openDb(join(root, '.aify-graph', 'graph.sqlite'));
    const node = (id, type, file) => db.run(
      `INSERT INTO nodes (id,type,label,file_path,start_line,end_line,language,confidence,extra)
       VALUES ($id,$t,$id,$f,1,1,'',1,'{}')`, { id, t: type, f: file });
    node('doc', 'Document', 'README.md');
    node('src', 'Function', 'src/a.js');
    const link = (extractor) => db.run(
      `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('doc','src','LINKS_TO','README.md',1,1,'EXTRACTED',$e)`, { e: extractor });
    link('doc_link:markdown');
    db.run(
      `INSERT INTO edges (from_id,to_id,relation,source_file,source_line,confidence,provenance,extractor)
       VALUES ('src','doc','LINKS_TO','src/a.js',1,1,'EXTRACTED','some-other-extractor')`);

    // ⛔ POSITIVE CONTROL FIRST: both rows must exist, or "the foreign edge survived" is true of
    // an edge that was never there.
    expect(db.get("SELECT COUNT(*) c FROM edges WHERE relation='LINKS_TO'").c).toBe(2);

    await detectDocLinks(db, root);

    expect(db.get("SELECT COUNT(*) c FROM edges WHERE extractor='some-other-extractor'").c,
      'another module’s edge is not this DELETE’s to remove').toBe(1);
    expect(db.get("SELECT COUNT(*) c FROM edges WHERE extractor='doc_link:markdown'").c,
      'CONTROL: its OWN stale edge IS removed, or the delete does nothing at all').toBe(0);
    db.close();
  }, 30_000);
});
