// #16: no instruction an agent reads may license an absence claim ("no callers", "dead code", "safe to delete").
//
// evidence.exhaustive is never issued (index_population_unattested), so every returned caller set is a floor and only
// rg can establish an absence. Yet the always-loaded server instructions called an lsp-verified banner a "safe basis
// for no callers / dead code / safe to delete", and five install guides and a shipped skill said absence claims "gate
// on evidence.exhaustive === true". skill-safety-contract.test.js guarded one skill; the same sentence lived on in the
// others. The population here is DERIVED from the tree, so a new guide or skill is covered without editing this test.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
const SURFACES = [
  ...readdirSync(ROOT).filter((f) => /^(README|AGENTS)\.md$|^install.*\.md$/u.test(f)).map((f) => join(ROOT, f)),
  ...walk(join(ROOT, 'integrations')).filter((f) => f.endsWith('.md')),
  join(ROOT, 'mcp', 'stdio', 'server-instructions.js'),
];

// The ways the retired authority has been written. A sentence that also says it is withdrawn is history, not advice.
const LICENSES = /gates?\s+on\s+`?evidence\.exhaustive\s*===\s*true|safe basis for\s+["“]?no callers|already certifies|trust the answer only when\s+`?evidence\.exhaustive|\bexhaustive with a\s+`?tsconfig/iu;
const WITHDRAWN = /withdrawn|withheld|was documented|never (?:true|issued|granted|reachable)|used to|not available|cannot license|retired/iu;

function licensingSentences(text) {
  return text.split(/(?<=[.!?])\s+|\n/u).filter((s) => LICENSES.test(s) && !WITHDRAWN.test(s));
}

describe('no instruction surface licenses an absence claim', () => {
  it('★★★ the derived population is the real one (control)', () => {
    const names = SURFACES.map((f) => relative(ROOT, f).replaceAll('\\', '/'));
    expect(names).toEqual(expect.arrayContaining(['README.md', 'install.claude.md', 'mcp/stdio/server-instructions.js']));
    expect(names.some((n) => n.startsWith('integrations/') && n.endsWith('SKILL.md'))).toBe(true);
  });

  it('★★★ the detector finds the retired sentence and passes its withdrawn form (control)', () => {
    expect(licensingSentences('Absence claims gate on `evidence.exhaustive === true`.')).toHaveLength(1);
    expect(licensingSentences('The claim that absence claims gate on `evidence.exhaustive === true` is withdrawn.')).toHaveLength(0);
  });

  it('★★★ no surface states it', () => {
    const offenders = SURFACES.flatMap((f) => licensingSentences(readFileSync(f, 'utf8'))
      .map((s) => `${relative(ROOT, f).replaceAll('\\', '/')}: ${s.trim().slice(0, 140)}`));
    expect(offenders).toEqual([]);
  });
});
