// PRODUCER-EMISSION INVENTORY — the other direction from the consumer-list subset gate.
//
// ⛔ WHY BOTH EXIST. `type-lists-are-subsets-of-the-taxonomy.test.js` proves two enumerated CONSUMER
// lists name only declared types. graph-senior-dev's claim limit on it is exact: it does NOT prove
// that every type a PRODUCER can emit is declared — a new extractor emitting a type absent from
// both lists leaves that gate green until a runtime census sees it on somebody's repo.
//
// That is how `BuildTarget` and `BuildTest` got in: `ingest/frameworks/cmake.js` emitted them,
// `server-instructions.js` documented them, `SPECIAL_TYPES` governed them, and `NODE_TYPES` never
// declared them — so every CMake repo reported a false `present_but_undeclared` drift.
//
// ⚠⚠ THE LIMIT OF THIS INSTRUMENT, STATED UP FRONT BECAUSE IT IS NOT SMALL. This is a SOURCE SCAN
// for STRING LITERALS. A type assigned through a variable is invisible to it — `extractors/generic.js`
// computes `resolvedType` and emits that, so the literal scan cannot see whatever it resolves to.
// The claim is therefore "every LITERALLY-emitted node type is declared", never "every emitted type".
//
// ⇒ AND THAT IS WHY IT IS NOT THE ONLY GUARD. The two instruments compose and neither is complete
// alone:
//
//     this file        catches a new literal BEFORE it ships, at author time
//     graph_census     catches ANY undeclared type, including computed ones, at runtime —
//                      `present_but_undeclared`, on the repo where it actually occurs
//
// A reader deciding whether the vocabulary is safe needs both facts, so both are named here rather
// than one being allowed to imply the other.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_TYPES } from '../../../mcp/stdio/storage/taxonomy.js';

const MCP = fileURLToPath(new URL('../../../mcp/stdio', import.meta.url));

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Every `type: 'SomeType'` literal in the node-producing trees, with the file that emits it. */
function emittedTypes() {
  const files = [...walk(join(MCP, 'ingest')), ...walk(join(MCP, 'analysis'))];
  const found = new Map();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:^|[\s{,])type:\s*'([A-Z][A-Za-z]+)'/g)) {
      if (!found.has(m[1])) found.set(m[1], file);
    }
  }
  return found;
}

describe('producers emit only declared node types', () => {
  it('★★★ THE INSTRUMENT WORKS — it finds types we know are emitted', () => {
    // ⛔ POSITIVE CONTROL FIRST. "No undeclared types emitted" is trivially true of a scan that
    // found nothing, and a wrong zero here agrees with exactly what we hope to see — so nothing
    // would ever collide with it. This repo has shipped that failure more than once.
    const found = emittedTypes();
    expect(found.size, 'the scan found a substantial set').toBeGreaterThanOrEqual(12);
    for (const known of ['Document', 'Config', 'Directory', 'BuildTarget', 'BuildTest']) {
      expect([...found.keys()], `${known} is emitted and must be seen`).toContain(known);
    }
    // ...and it discriminates: a type nobody emits must not appear.
    expect([...found.keys()]).not.toContain('NotARealNodeType');
  });

  it('★★★ every literally-emitted type is declared in NODE_TYPES', () => {
    // The arm that was RED before BuildTarget/BuildTest were declared — and the one that would have
    // found them at author time instead of on a user's CMake repo.
    const found = emittedTypes();
    const undeclared = [...found.entries()]
      .filter(([type]) => !NODE_TYPES.includes(type))
      .map(([type, file]) => `${type} (emitted by ${file.slice(file.indexOf('mcp'))})`);
    expect(undeclared, 'a producer emitting an undeclared type creates a false census drift')
      .toEqual([]);
  });

  it('★★★ CONTROL: the predicate can say NO', () => {
    // Without this, the assertion above is satisfied by a filter that always returns empty.
    expect(['Document', 'NotARealNodeType'].filter((t) => !NODE_TYPES.includes(t)))
      .toEqual(['NotARealNodeType']);
  });

  it('★★★ the scan reports what it CANNOT see, so the gap is not inferred from a green run', () => {
    // ⚠ Computed types are invisible to a literal scan. This asserts the known instance still
    // exists, so the limitation stays true rather than silently lapsing into a claim of totality —
    // if `generic.js` ever stops computing its type, this test should be revisited, not deleted.
    const generic = readFileSync(join(MCP, 'ingest', 'extractors', 'generic.js'), 'utf8');
    expect(generic, 'a computed type the literal scan cannot resolve')
      .toMatch(/resolvedType/);
  });
});
