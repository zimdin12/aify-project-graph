import { describe, it, expect } from 'vitest';
import { runDoctor } from '../../../../mcp/stdio/code-intel/cli/doctor.js';

function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  return Promise.resolve(fn()).then(code => { process.stdout.write = originalWrite; return { code, output: captured }; });
}

describe('apg code-intel doctor', () => {
  it('reports per-language status for cpp', async () => {
    const { code, output } = await captureStdout(() => runDoctor(['cpp']));
    // Always returns 0 (doctor is informational); content includes language and clangd status.
    expect(code).toBe(0);
    expect(output).toMatch(/cpp/);
    expect(output).toMatch(/clangd/i);
  });

  it('reports all languages when no arg given', async () => {
    const { code, output } = await captureStdout(() => runDoctor([]));
    expect(code).toBe(0);
    expect(output).toMatch(/cpp/);
  });
});
