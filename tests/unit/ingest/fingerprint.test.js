import { describe, expect, it } from 'vitest';

import {
  dependencyFingerprint,
  structuralFingerprint,
  symbolFingerprints,
} from '../../../mcp/stdio/ingest/fingerprint.js';

describe('fingerprint', () => {
  it('keeps structural fingerprint stable when only dependency order changes', () => {
    const symbol = {
      qname: 'pkg.module.parseFoo',
      signature: '(value: string) => Foo',
      decorators: ['cached', 'trace'],
      parentClass: 'Parser',
      nodeType: 'Function',
      outgoing: {
        calls: ['db.query', 'audit.log'],
        references: ['FooError'],
        usesTypes: ['Foo'],
        imports: ['pkg.types.Foo', 'pkg.db.query'],
        raises: ['FooError'],
      },
    };

    const reordered = {
      ...symbol,
      outgoing: {
        calls: ['audit.log', 'db.query'],
        references: ['FooError'],
        usesTypes: ['Foo'],
        imports: ['pkg.db.query', 'pkg.types.Foo'],
        raises: ['FooError'],
      },
    };

    expect(structuralFingerprint(symbol)).toBe(structuralFingerprint(reordered));
    expect(dependencyFingerprint(symbol)).toBe(dependencyFingerprint(reordered));
  });

  it('changes only dependency fingerprint for body-level dependency edits', () => {
    const before = {
      qname: 'pkg.module.parseFoo',
      signature: '(value: string) => Foo',
      decorators: ['cached'],
      parentClass: 'Parser',
      nodeType: 'Function',
      outgoing: {
        calls: ['db.query'],
        references: ['FooError'],
        usesTypes: ['Foo'],
        imports: ['pkg.db.query'],
        raises: [],
      },
    };

    const after = {
      ...before,
      outgoing: {
        ...before.outgoing,
        calls: ['db.query', 'audit.log'],
      },
    };

    expect(structuralFingerprint(before)).toBe(structuralFingerprint(after));
    expect(dependencyFingerprint(before)).not.toBe(dependencyFingerprint(after));
  });

  it('changes only structural fingerprint for signature or type changes', () => {
    const before = {
      qname: 'pkg.module.parseFoo',
      signature: '(value: string) => Foo',
      decorators: ['cached'],
      parentClass: 'Parser',
      nodeType: 'Function',
      outgoing: {
        calls: ['db.query'],
        references: [],
        usesTypes: ['Foo'],
        imports: ['pkg.db.query'],
        raises: [],
      },
    };

    const after = {
      ...before,
      signature: '(value: string, strict = false) => Foo',
    };

    expect(structuralFingerprint(before)).not.toBe(structuralFingerprint(after));
    expect(dependencyFingerprint(before)).toBe(dependencyFingerprint(after));
  });

  it('includes node type in the structural fingerprint', () => {
    const base = {
      qname: 'pkg.module.parseFoo',
      signature: '(value: string) => Foo',
      decorators: [],
      parentClass: '',
      outgoing: {
        calls: [],
        references: [],
        usesTypes: [],
        imports: [],
        raises: [],
      },
    };

    expect(
      structuralFingerprint({ ...base, nodeType: 'Function' }),
    ).not.toBe(
      structuralFingerprint({ ...base, nodeType: 'Method' }),
    );
  });

  it('returns both fingerprints together from symbolFingerprints', () => {
    const fingerprints = symbolFingerprints({
      qname: 'pkg.module.parseFoo',
      signature: '(value: string) => Foo',
      decorators: ['cached'],
      parentClass: 'Parser',
      nodeType: 'Function',
      outgoing: {
        calls: ['db.query'],
        references: ['FooError'],
        usesTypes: ['Foo'],
        imports: ['pkg.db.query'],
        raises: [],
      },
    });

    expect(fingerprints).toEqual({
      structural_fp: expect.any(String),
      dependency_fp: expect.any(String),
    });
    expect(fingerprints.structural_fp).not.toBe(fingerprints.dependency_fp);
  });
});
