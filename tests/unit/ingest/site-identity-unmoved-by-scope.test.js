// GATE 7 — step B must not move symbol SITE identity.
//
// Step B taught the C++ extractor to carry lexical scope into the qname. Site identity is a
// DIFFERENT identity: a byte-span address, deliberately blind to what a symbol is called. If
// scope leaked into it, every C++ symbol in a namespace would get a new id on this commit —
// silently re-keying containment edges, ledger rows and every stored reference to them.
//
// ⚠ THE PIN IS A MEASUREMENT, NOT AN ASSERTION FROM TODAY'S CODE. The 18 ids below were
// extracted from a detached worktree at 8c1bdc3 (pre-B) and byte-compared against post-B:
//   18 sites, zero differences. Method and receipt: docs/evidence/m1a-step-b/GATE-7-FINDING.md
// Pinning ids produced by the code under test would prove only that it agrees with itself.
//
// ⚠ Claim ceiling: site identity is unmoved ON THIS FROZEN FIXTURE. Not a claim about every
// C++ file, and not a claim that site identity is CORRECT — only that step B did not change it.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';
import { codeSymbolSiteId } from '../../../mcp/stdio/ingest/identity/code-symbol-site-id.js';

const FIXTURE = fileURLToPath(new URL('../../fixtures/identity-hostile/src', import.meta.url));
const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);

// Measured at 8c1bdc3 (pre-B). Format: `<repo-relative path>:<start_line>:<site id>`.
const PRE_B_SITE_POPULATION = [
  'src/other.cpp:12:01ec96fab3f7c9a0bc094f88f83938002ba47406',
  'src/other.cpp:5:586882d46dd229e2e077edddd98f9b74d78f2aac',
  'src/other.cpp:9:fca58f09802fde07cb24d73507f46cd249ffd52b',
  'src/shapes.cpp:11:76478b77f7714b809543135d50182b0c7624aeea',
  'src/shapes.cpp:14:b8ac81a076817d48d90c3601f8fa52dc4b17633b',
  'src/shapes.cpp:15:2aa02ee04ed389aa58f698dd5a400df79ebf307e',
  'src/shapes.cpp:17:64046bdad68633981aa5a216c2e5f6b7334bf29a',
  'src/shapes.cpp:24:591e522424b50480f92d23739e5e8e7de9d1e61b',
  'src/shapes.cpp:29:3fea37afc1cfa372e244f8b28fb8852fbc8a7b59',
  'src/shapes.cpp:31:919d8d9ad17669ef1eefb8affdcd67db7084592f',
  'src/shapes.cpp:6:9f529fed619df205f3509b99f3236a5f9fe7dd57',
  'src/shapes.cpp:8:35f4a3c0feb69b61aaaa2c4b18493c91a59994ef',
  'src/shapes.h:19:19626303496c73315d39f617f6ebd880e2fdfee8',
  'src/shapes.h:27:c60d2d95b23225b5b95a2f40b5e5d1ff1b751e31',
  'src/shapes.h:29:bc34e434950ffe809fa5f4933ef541b45d87e891',
  'src/shapes.h:5:9c9e5dcfeba8fb48710981db12cc2d503de16008',
  'src/shapes.h:7:a7ef03d840c37a1cad81e8b75f4d35ab6185af59',
  'src/shapes.h:8:9e244a01d17cad366d37f01e857370fa70a46949',
];

function extractSymbolNodes() {
  const nodes = [];
  for (const file of fs.readdirSync(FIXTURE).sort()) {
    const filePath = `src/${file}`;
    const source = fs.readFileSync(path.join(FIXTURE, file), 'utf8');
    const config = getLanguageConfig(filePath);
    const result = extractFile({ filePath, source, config });
    for (const node of result.nodes ?? []) {
      if (SYMBOL_TYPES.has(node.type)) nodes.push({ filePath, config, node });
    }
  }
  return nodes;
}

describe('gate 7 — lexical scope does not reach site identity', () => {
  const symbols = extractSymbolNodes();

  it('the fixture still yields the population the pin was taken over', () => {
    // Positive control. If the fixture were renamed or emptied, an all-empty population would
    // compare equal to an all-empty pin and this file would certify nothing.
    expect(symbols.length).toBe(PRE_B_SITE_POPULATION.length);
    for (const { node } of symbols) {
      expect(node.id).toMatch(/^[0-9a-f]{40}$/);
      expect(Number.isInteger(node.extra?.site_start_byte)).toBe(true);
      expect(Number.isInteger(node.extra?.site_end_byte)).toBe(true);
    }
  });

  it('every site id is byte-identical to the pre-B measurement', () => {
    const observed = symbols
      .map(({ filePath, node }) => `${filePath}:${node.start_line}:${node.id}`)
      .sort();
    expect(observed).toEqual(PRE_B_SITE_POPULATION);
  });

  it('each id recomputes from its byte span alone — no name, scope or qname in the preimage', () => {
    // A second substrate for the same claim: the pin says "unchanged since pre-B", this says
    // "derived from nothing but the span". Contaminating the id with scope breaks this even if
    // someone re-pins the literals above to match the contaminated output.
    for (const { filePath, config, node } of symbols) {
      const recomputed = codeSymbolSiteId({
        language: config.language,
        filePath,
        startByte: node.extra.site_start_byte,
        endByte: node.extra.site_end_byte,
      });
      expect(recomputed).toBe(node.id);
    }
  });

  it('the fixture DOES carry lexical scope — so this file is testing scoped symbols, not trivia', () => {
    // Without this, the three assertions above would pass on a fixture with no namespaces at
    // all, where scope could not possibly have leaked because there was none to leak.
    const scoped = symbols.filter(({ node }) => (node.extra?.lexical_scope ?? []).length > 0);
    expect(scoped.length).toBeGreaterThan(0);
    const qnames = scoped.map(({ node }) => node.extra.qname);
    expect(qnames.some((q) => q.includes('alpha'))).toBe(true);
    expect(qnames.some((q) => q.includes('beta'))).toBe(true);
  });
});
