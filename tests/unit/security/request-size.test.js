// Plan #21 tests: MCP request-size cap.

import { describe, it, expect } from 'vitest';
import { checkRequestSize, MAX_MCP_LINE_BYTES } from '../../../mcp/stdio/security/request-size.js';

describe('checkRequestSize', () => {
  it('returns null for tiny lines', () => {
    expect(checkRequestSize('{"jsonrpc":"2.0"}')).toBeNull();
    expect(checkRequestSize('')).toBeNull();
  });

  it('returns null for non-string input (defensive)', () => {
    expect(checkRequestSize(null)).toBeNull();
    expect(checkRequestSize(undefined)).toBeNull();
    expect(checkRequestSize(42)).toBeNull();
    expect(checkRequestSize({})).toBeNull();
  });

  it('returns null exactly at the cap (cap is the boundary, inclusive)', () => {
    const line = 'x'.repeat(MAX_MCP_LINE_BYTES);
    expect(checkRequestSize(line)).toBeNull();
  });

  it('returns a JSON-RPC error envelope when oversize', () => {
    const line = 'x'.repeat(MAX_MCP_LINE_BYTES + 1);
    const err = checkRequestSize(line);
    expect(err).not.toBeNull();
    expect(err.jsonrpc).toBe('2.0');
    expect(err.id).toBeNull();
    expect(err.error.code).toBe(-32600);
    expect(err.error.message).toMatch(/exceeds/);
    expect(err.error.data.maxBytes).toBe(MAX_MCP_LINE_BYTES);
    expect(err.error.data.observedBytes).toBeGreaterThan(MAX_MCP_LINE_BYTES);
  });

  it('measures bytes not characters (multi-byte safe)', () => {
    // Each emoji is 4 bytes in UTF-8 → 64K characters = 256K bytes
    const chars = MAX_MCP_LINE_BYTES / 4;
    const justUnder = '😀'.repeat(chars);
    expect(checkRequestSize(justUnder)).toBeNull();
    const justOver = justUnder + '😀';
    const err = checkRequestSize(justOver);
    expect(err).not.toBeNull();
    expect(err.error.data.observedBytes).toBeGreaterThan(MAX_MCP_LINE_BYTES);
  });

  it('MAX_MCP_LINE_BYTES is the documented 256KB', () => {
    expect(MAX_MCP_LINE_BYTES).toBe(256 * 1024);
  });
});
