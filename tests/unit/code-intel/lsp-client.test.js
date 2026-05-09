import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { LspClient } from '../../../mcp/stdio/code-intel/lsp-client.js';

const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

describe('LspClient (against fake server)', () => {
  it('initializes, gets references, and shuts down cleanly', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const refs = await client.references('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(Array.isArray(refs)).toBe(true);
    expect(refs.length).toBe(1);
    expect(refs[0].uri).toContain('bar.cpp');
    await client.shutdown();
  });

  it('collects diagnostics published during didOpen', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/bad.cpp', 'cpp', 'int x = ;');
    // give the server a moment to emit the publishDiagnostics notification
    await new Promise(r => setTimeout(r, 50));
    const diags = client.diagnosticsFor('file:///r/src/bad.cpp');
    expect(diags.length).toBe(1);
    expect(diags[0].message).toMatch(/undeclared/);
    await client.shutdown();
  });

  it('returns hover content', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///r' });
    await client.start();
    await client.didOpen('file:///r/src/foo.cpp', 'cpp', 'void foo(int) {}');
    const hover = await client.hover('file:///r/src/foo.cpp', { line: 0, character: 5 });
    expect(hover.contents.value).toMatch(/void foo/);
    await client.shutdown();
  });
});
