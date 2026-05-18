import { describe, it, expect, beforeEach } from 'vitest';
import { runCodeIntelCmd } from '../../../../mcp/stdio/code-intel/cli/code-intel-cmd.js';
import { registerProvider, clearProviders } from '../../../../mcp/stdio/code-intel/providers/index.js';

beforeEach(() => clearProviders());

function captureStdout(fn) {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = (s) => { captured += s; return true; };
  return Promise.resolve(fn()).then(code => { process.stdout.write = originalWrite; return { code, output: captured }; });
}

describe('apg code-intel CLI', () => {
  it('prints help when called without args', async () => {
    const { code, output } = await captureStdout(() => runCodeIntelCmd([]));
    expect(code).toBe(0);
    expect(output).toMatch(/collect/);
    expect(output).toMatch(/analyze/);
    expect(output).toMatch(/doctor/);
  });

  it('collect: writes a v0.2 collection JSON to stdout when --json', async () => {
    registerProvider('cpp-clangd', () => ({
      capabilities: () => ({ provider: 'cpp-clangd', version: '0.0.1', languages: ['cpp'], operations: ['definitions'], freshnessBasis: 'unknown', warmupRequired: false, limits: {} }),
      collect: async (req) => ({
        schema_version: '0.2', collectionId: 'ci-cli-1', provider: 'cpp-clangd', providerVersion: '0.0.1',
        projectRoot: req.projectRoot,
        session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
        operations: { definitions: { status: 'ok', count: 0 } }, status: 'ok', records: []
      })
    }));
    const { code, output } = await captureStdout(() =>
      runCodeIntelCmd(['collect', 'cpp', '--project-root', '/r', '--json'])
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(output);
    expect(parsed.schema_version).toBe('0.2');
    expect(parsed.status).toBe('ok');
  });

  it('collect: returns non-zero exit on error collection', async () => {
    const { code } = await captureStdout(() =>
      runCodeIntelCmd(['collect', 'unknown-language', '--project-root', '/r', '--json'])
    );
    expect(code).toBe(2);
  });

  it('analyze: writes bounded analyzer JSON to stdout', async () => {
    const { code, output } = await captureStdout(() =>
      runCodeIntelCmd(['analyze', 'cpp', '--project-root', '/r', '--files', 'src/a.cpp', '--json'])
    );
    expect(code).toBe(2);
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('error');
    expect(parsed.errors[0].code).toBe('compile_db_missing');
  });
});
