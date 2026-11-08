// #17: docs/DECISIONS.md says which recorded decisions still apply. Each row cites its source as `path:line` "words",
// and this test reads that line and requires the words on it. A note that moves (the archive step), or text that shifts
// (a pointer line added under a title), turns this red instead of leaving the index pointing at the wrong sentence.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const INDEX = 'docs/DECISIONS.md';
const CITATION = /`(docs\/[^`]+?\.md):(\d+)` "([^"]+)"/gu;

const citationsIn = (text) => [...text.matchAll(CITATION)].map(([, path, line, words]) => ({ path, line: Number(line), words }));

// One finding per citation that does not hold; empty when every cited line carries its words.
function unresolved(citations, read = (p) => readFileSync(join(REPO, p), 'utf8')) {
  return citations.flatMap(({ path, line, words }) => {
    if (!existsSync(join(REPO, path))) return [`${path}: no such file`];
    const at = read(path).split(/\r?\n/u)[line - 1];
    if (at === undefined) return [`${path}:${line}: past the end of the file`];
    return at.includes(words) ? [] : [`${path}:${line}: "${words}" is not on this line`];
  });
}

const text = readFileSync(join(REPO, INDEX), 'utf8');
const citations = citationsIn(text);

describe('DECISIONS.md cites real lines', () => {
  it('★★★ the checker finds a citation that holds and refuses one that does not (control)', () => {
    const planted = citationsIn('`docs/DECISIONS.md:1` "# Decisions" and `docs/DECISIONS.md:1` "Not this"'
      + ' and `docs/DECISIONS.md:999999` "x" and `docs/nope.md:1` "x"');
    expect(planted).toHaveLength(4);
    expect(unresolved(planted)).toEqual([
      'docs/DECISIONS.md:1: "Not this" is not on this line',
      'docs/DECISIONS.md:999999: past the end of the file',
      'docs/nope.md: no such file',
    ]);
  });

  it('★★★ every citation in the index holds', () => {
    expect(citations.length, 'the parser found too few citations: it is blind, not satisfied').toBeGreaterThan(40);
    expect(unresolved(citations)).toEqual([]);
  });

  it('★★ the rows #17 requires are there: F4 current and its spike superseded, the seam items, the 2026-11-04 decision', () => {
    const rows = text.split(/\r?\n/u).filter((l) => l.startsWith('| 20'));
    const row = (needle) => rows.filter((r) => r.includes(needle));
    expect(row('2026-08-30-f4-php-is-gated-on-a-runtime').filter((r) => r.includes('| CURRENT |'))).toHaveLength(1);
    expect(row('2026-08-26-f4-php-spike.md').filter((r) => r.includes('SUPERSEDED 2026-08-30'))).toHaveLength(1);
    expect(row('ROLES.md').filter((r) => r.includes('| CURRENT |') && r.includes('Yes, owner decision 2026-11-04'))).toHaveLength(1);
    expect(rows.filter((r) => r.startsWith('| 2026-09-20') && r.includes('SUPERSEDED')).length).toBeGreaterThanOrEqual(3);
  });
});
