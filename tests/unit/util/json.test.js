// P5-1: pre-parse JSON size cap (memory-bomb guard).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readJsonCapped,
  readJsonCappedSafe,
  JsonTooLargeError,
  DEFAULT_JSON_MAX_BYTES,
} from '../../../mcp/stdio/util/json.js';

describe('readJsonCapped', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apg-json-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('parses a file UNDER the cap', () => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ hello: 'world', n: 42 }));
    expect(readJsonCapped(p)).toEqual({ hello: 'world', n: 42 });
  });

  it('throws JsonTooLargeError when OVER the cap, without reading the bytes', () => {
    const p = join(dir, 'big.json');
    // ~2KB payload, cap 100 bytes → over.
    writeFileSync(p, JSON.stringify({ blob: 'x'.repeat(2048) }));
    let thrown;
    try { readJsonCapped(p, { maxBytes: 100 }); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(JsonTooLargeError);
    expect(thrown.code).toBe('JSON_TOO_LARGE');
    expect(thrown.cap).toBe(100);
    expect(thrown.size).toBeGreaterThan(100);
  });

  it('honors a file exactly AT the cap (not over)', () => {
    const p = join(dir, 'edge.json');
    const payload = JSON.stringify({ a: 1 });
    writeFileSync(p, payload);
    // cap == exact byte length → allowed (only strictly-over is rejected).
    expect(readJsonCapped(p, { maxBytes: Buffer.byteLength(payload) })).toEqual({ a: 1 });
  });

  it('reads APG_JSON_MAX_BYTES from env when no maxBytes passed', () => {
    const p = join(dir, 'envcap.json');
    writeFileSync(p, JSON.stringify({ blob: 'y'.repeat(2048) }));
    expect(() => readJsonCapped(p, { env: { APG_JSON_MAX_BYTES: '100' } }))
      .toThrow(JsonTooLargeError);
  });

  it('returns null for a missing file by default (mustExist=false)', () => {
    expect(readJsonCapped(join(dir, 'nope.json'))).toBeNull();
  });

  it('throws ENOENT for a missing file when mustExist=true', () => {
    expect(() => readJsonCapped(join(dir, 'nope.json'), { mustExist: true }))
      .toThrow(/ENOENT/);
  });

  it('default cap is 64 MiB', () => {
    expect(DEFAULT_JSON_MAX_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('readJsonCappedSafe', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apg-json-safe-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns null on over-cap instead of throwing', () => {
    const p = join(dir, 'big.json');
    writeFileSync(p, JSON.stringify({ blob: 'x'.repeat(2048) }));
    expect(readJsonCappedSafe(p, { maxBytes: 100 })).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{ not: valid');
    expect(readJsonCappedSafe(p)).toBeNull();
  });

  it('returns the value on a good under-cap file', () => {
    const p = join(dir, 'ok.json');
    writeFileSync(p, JSON.stringify({ v: 1 }));
    expect(readJsonCappedSafe(p)).toEqual({ v: 1 });
  });

  it('detailed mode surfaces the error object on over-cap', () => {
    const p = join(dir, 'big.json');
    writeFileSync(p, JSON.stringify({ blob: 'x'.repeat(2048) }));
    const r = readJsonCappedSafe(p, { maxBytes: 100, detailed: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBeInstanceOf(JsonTooLargeError);
  });
});
