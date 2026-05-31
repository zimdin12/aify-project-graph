// Registry shape + invariants for the single taxonomy authority
// (storage/taxonomy.js). Guards the cohesion contract from review R2:
// families are subsets of RELATIONS, no dupes, the provenance ladder is the
// canonical ordered set, and the new edge types are wired into the neighbor
// family.

import { describe, it, expect } from 'vitest';
import {
  NODE_TYPES,
  RELATIONS,
  EXECUTION_FAMILY,
  CALL_FAMILY,
  IMPACT_FAMILY,
  IMPORT_FAMILY,
  INHERITANCE_FAMILY,
  BRIDGE_FAMILY,
  PROVENANCE_CALL_FAMILY,
  NEIGHBOR_FAMILY,
  PATH_MODE_FAMILIES,
  EDGE_PROVENANCE_TYPES,
  PROVENANCE_RANK,
} from '../../../mcp/stdio/storage/taxonomy.js';
import {
  EDGE_PROVENANCE_TYPES as SCHEMA_PROVENANCE,
  NODE_TYPES as SCHEMA_NODE_TYPES,
} from '../../../mcp/stdio/storage/schema.js';

const noDupes = (arr) => new Set(arr).size === arr.length;
const isSubset = (sub, sup) => {
  const s = new Set(sup);
  return sub.every((x) => s.has(x));
};

describe('taxonomy registry shape', () => {
  it('NODE_TYPES is a non-empty deduped set', () => {
    expect(NODE_TYPES.length).toBeGreaterThan(0);
    expect(noDupes(NODE_TYPES)).toBe(true);
  });

  it('RELATIONS is a non-empty deduped set', () => {
    expect(RELATIONS.length).toBeGreaterThan(0);
    expect(noDupes(RELATIONS)).toBe(true);
  });

  it('contains the canonical node types and NO phantom Struct', () => {
    for (const t of ['File', 'Function', 'Method', 'Class', 'Symbol', 'External', 'ShaderBinding']) {
      expect(NODE_TYPES).toContain(t);
    }
    expect(NODE_TYPES).not.toContain('Struct');
  });

  it('contains every relation the verbs traverse, including the new edge types', () => {
    for (const r of [
      'CALLS', 'INVOKES', 'PASSES_THROUGH', 'REFERENCES', 'USES_TYPE',
      'EXTENDS', 'IMPLEMENTS', 'OVERRIDDEN_BY', 'IMPORTS', 'INCLUDES',
      'CONTAINS', 'DEFINES', 'LOADS_SHADER', 'DECLARES_BINDING',
      'HAS_DIAGNOSTIC', 'MENTIONS', 'TESTS',
    ]) {
      expect(RELATIONS).toContain(r);
    }
  });
});

describe('families are deduped subsets of RELATIONS', () => {
  const families = {
    EXECUTION_FAMILY,
    CALL_FAMILY,
    IMPACT_FAMILY,
    IMPORT_FAMILY,
    INHERITANCE_FAMILY,
    BRIDGE_FAMILY,
    PROVENANCE_CALL_FAMILY,
    NEIGHBOR_FAMILY,
  };
  for (const [name, fam] of Object.entries(families)) {
    it(`${name} is deduped and ⊆ RELATIONS`, () => {
      expect(noDupes(fam)).toBe(true);
      expect(isSubset(fam, RELATIONS)).toBe(true);
    });
  }

  it('PATH_MODE_FAMILIES modes are subsets of RELATIONS', () => {
    expect(isSubset(PATH_MODE_FAMILIES.execution, RELATIONS)).toBe(true);
    expect(isSubset(PATH_MODE_FAMILIES.dependency, RELATIONS)).toBe(true);
  });
});

describe('family composition (reconciliations)', () => {
  it('EXECUTION_FAMILY is the strict call graph', () => {
    expect([...EXECUTION_FAMILY].sort()).toEqual(['CALLS', 'INVOKES', 'PASSES_THROUGH'].sort());
  });

  it('CALL_FAMILY = EXECUTION_FAMILY + REFERENCES', () => {
    expect(isSubset(EXECUTION_FAMILY, CALL_FAMILY)).toBe(true);
    expect(CALL_FAMILY).toContain('REFERENCES');
  });

  it('IMPACT_FAMILY ⊇ CALL_FAMILY and adds USES_TYPE, TESTS, OVERRIDDEN_BY', () => {
    expect(isSubset(CALL_FAMILY, IMPACT_FAMILY)).toBe(true);
    for (const r of ['USES_TYPE', 'TESTS', 'OVERRIDDEN_BY']) expect(IMPACT_FAMILY).toContain(r);
  });

  it('INHERITANCE_FAMILY is the type-hierarchy set', () => {
    expect([...INHERITANCE_FAMILY].sort()).toEqual(['EXTENDS', 'IMPLEMENTS', 'OVERRIDDEN_BY'].sort());
  });

  it('BRIDGE_FAMILY is the shader bridge set', () => {
    expect([...BRIDGE_FAMILY].sort()).toEqual(['DECLARES_BINDING', 'LOADS_SHADER'].sort());
  });

  it('NEIGHBOR_FAMILY exposes the new edge types (graph_neighbors fix)', () => {
    for (const r of ['OVERRIDDEN_BY', 'LOADS_SHADER', 'DECLARES_BINDING', 'HAS_DIAGNOSTIC']) {
      expect(NEIGHBOR_FAMILY).toContain(r);
    }
    // it is the full relation set
    expect([...NEIGHBOR_FAMILY].sort()).toEqual([...RELATIONS].sort());
  });
});

describe('provenance ladder', () => {
  it('is the canonical ordered set', () => {
    expect(EDGE_PROVENANCE_TYPES).toEqual([
      'EXTRACTED', 'INFERRED', 'AMBIGUOUS', 'CODE_INTEL', 'LSP_VERIFIED',
    ]);
    expect(noDupes(EDGE_PROVENANCE_TYPES)).toBe(true);
  });

  it('rank reflects weakest→strongest order; LSP_VERIFIED outranks CODE_INTEL', () => {
    expect(PROVENANCE_RANK.EXTRACTED).toBe(0);
    expect(PROVENANCE_RANK.LSP_VERIFIED).toBe(EDGE_PROVENANCE_TYPES.length - 1);
    expect(PROVENANCE_RANK.LSP_VERIFIED).toBeGreaterThan(PROVENANCE_RANK.CODE_INTEL);
    expect(PROVENANCE_RANK.CODE_INTEL).toBeGreaterThan(PROVENANCE_RANK.INFERRED);
  });

  it('schema.js re-exports the registry (single authority)', () => {
    expect(SCHEMA_PROVENANCE).toBe(EDGE_PROVENANCE_TYPES);
    expect(SCHEMA_NODE_TYPES).toBe(NODE_TYPES);
  });
});
