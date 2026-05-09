import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateRecord,
  validateCollection,
  isV02Collection
} from '../../../../mcp/stdio/ingest/code-intel/v02.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../fixtures/code-intel/v02');

const loadFixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'));

describe('code-intel v0.2 validation', () => {
  it('validates the basic collection fixture', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validates the partial collection fixture', () => {
    const collection = loadFixture('cpp-partial-collection.json');
    const result = validateCollection(collection);
    expect(result.valid).toBe(true);
  });

  it('rejects a collection missing collectionId', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    delete collection.collectionId;
    const result = validateCollection(collection);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => /collectionId/.test(e))).toBe(true);
  });

  it('rejects a collection with unknown error code', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    collection.status = 'error';
    collection.errors = [{ code: 'made_up_code', message: 'x' }];
    const result = validateCollection(collection);
    expect(result.valid).toBe(false);
  });

  it('rejects a record with absolute path', () => {
    const record = {
      schema_version: '0.2',
      collectionId: 'ci-1',
      kind: 'diagnostic',
      language: 'cpp',
      file: '/abs/path/file.cpp',
      severity: 'error',
      message: 'oops'
    };
    const result = validateRecord(record);
    expect(result.valid).toBe(false);
  });

  it('rejects a definition record missing symbolId', () => {
    const record = {
      schema_version: '0.2',
      collectionId: 'ci-1',
      kind: 'definition',
      language: 'cpp',
      qname: 'ns::foo()',
      file: 'src/foo.cpp'
    };
    const result = validateRecord(record);
    expect(result.valid).toBe(false);
  });

  it('isV02Collection returns true for v0.2 envelope', () => {
    const collection = loadFixture('cpp-basic-collection.json');
    expect(isV02Collection(collection)).toBe(true);
  });

  it('isV02Collection returns false for v0.1 record', () => {
    const v01 = { kind: 'symbol', qname: 'foo', file_path: 'src/foo.cpp' };
    expect(isV02Collection(v01)).toBe(false);
  });
});
