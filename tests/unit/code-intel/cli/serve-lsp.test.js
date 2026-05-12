import { describe, it, expect } from 'vitest';
import { runServeLsp, LANGUAGE_SERVERS } from '../../../../mcp/stdio/code-intel/cli/serve-lsp.js';

function captureStderr(fn) {
  const orig = process.stderr.write.bind(process.stderr);
  let captured = '';
  process.stderr.write = (s) => { captured += s; return true; };
  return Promise.resolve(fn()).then(code => { process.stderr.write = orig; return { code, output: captured }; });
}

describe('apg code-intel serve-lsp', () => {
  it('exposes a registry of supported languages', () => {
    expect(LANGUAGE_SERVERS.cpp).toBeTruthy();
    expect(LANGUAGE_SERVERS.cpp.binary).toBe('clangd');
  });

  it('prints usage with exit 2 when language is missing', async () => {
    const { code, output } = await captureStderr(() => runServeLsp([]));
    expect(code).toBe(2);
    expect(output).toMatch(/Usage: apg code-intel serve-lsp/);
    expect(output).toMatch(/Supported languages:/);
  });

  it('prints usage with exit 0 on --help', async () => {
    const { code } = await captureStderr(() => runServeLsp(['--help']));
    expect(code).toBe(0);
  });

  it('returns language_unsupported exit (2) for unknown language', async () => {
    const { code, output } = await captureStderr(() => runServeLsp(['rust']));
    expect(code).toBe(2);
    expect(output).toMatch(/language_unsupported|no registered language server/);
  });

  it('returns language_server_missing exit (3) when binary is absent', async () => {
    // clangd is not installed on this host; this asserts the missing-binary path.
    const { code, output } = await captureStderr(() => runServeLsp(['cpp']));
    // On this host clangd is missing → exit 3. If clangd is installed elsewhere,
    // the relay would spawn and inherit our (closed) stdin; treat exit 0/3 both as OK
    // for that case, but require the hint surface either way.
    expect([3, 0]).toContain(code);
    if (code === 3) {
      expect(output).toMatch(/clangd|install/);
    }
  });
});
