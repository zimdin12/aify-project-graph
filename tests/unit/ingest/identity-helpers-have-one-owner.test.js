// #19: graph identity and its text helpers are defined once.
//
// stableId (a sha1 of the joined parts) IS node identity. It was copied byte-for-byte into the generic extractor,
// the sweep and the Laravel plugin beside the exported one in frameworks/_plugin_utils.js; nodeText was copied into
// four files beside walker.js's export. One copy drifting would silently give the same node two ids. The population
// is every .js under mcp/, derived, so a fifth copy anywhere is caught.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stableId } from '../../../mcp/stdio/ingest/identity.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const SOURCES = walk(join(ROOT, 'mcp')).filter((f) => f.endsWith('.js'));

function definitionsOf(name) {
  const declares = new RegExp(`^(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`, 'mu');
  return SOURCES.filter((f) => declares.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f).replaceAll('\\', '/'));
}

describe('identity helpers have one definition in mcp/', () => {
  it('★★★ control: the scan finds a helper that exists exactly once, and the population is the real tree', () => {
    expect(SOURCES.length).toBeGreaterThan(100);
    expect(definitionsOf('extractFile')).toHaveLength(1);
  });

  it.each(['stableId', 'nodeText'])('★★★ %s is defined once', (name) => {
    expect(definitionsOf(name)).toHaveLength(1);
  });

  it('★★★ node identity bytes are unchanged: sha1 of the parts joined with "::"', () => {
    // Literal from the definition every copy shared before the dedupe. A change here is a migration (every graph's
    // node ids move), never a refactor.
    expect(stableId(['Function', 'src/a.js', 'foo'])).toBe('72a988aab38d83dc443be0651f0b942ca0f4e5eb');
  });
});
