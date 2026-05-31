// Unit tests for the opt-in WSL-clangd transport (APG_CLANGD_WSL).
// All real-WSL touch points are mocked — these run on any platform/CI without
// WSL installed. Real-WSL behaviour is verified separately by the POC scripts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { wslToHost, hostToWsl } from '../../../mcp/stdio/code-intel/compile-db.js';
import {
  buildClangdSpawn,
  decideWslMode,
  detectWslClangd,
  wslModeRequested,
  _resetWslProbeCache
} from '../../../mcp/stdio/code-intel/resolve-clangd.js';
import { translateUri, LspClient } from '../../../mcp/stdio/code-intel/lsp-client.js';
import path from 'node:path';

const isWin = process.platform === 'win32';
const fakeServer = path.resolve('tests/fixtures/code-intel/lsp/fake-lsp-server.mjs');

describe('hostToWsl / wslToHost round-trip', () => {
  it('hostToWsl maps a Windows drive path to /mnt/<drive>/...', () => {
    expect(hostToWsl('C:/Users/x/a.cpp')).toBe('/mnt/c/Users/x/a.cpp');
    expect(hostToWsl('C:\\Users\\x\\a.cpp')).toBe('/mnt/c/Users/x/a.cpp');
    expect(hostToWsl('D:/build-linux')).toBe('/mnt/d/build-linux');
    expect(hostToWsl('C:/')).toBe('/mnt/c/');
  });

  it('hostToWsl leaves posix / already-WSL paths unchanged', () => {
    expect(hostToWsl('/usr/bin/c++')).toBe('/usr/bin/c++');
    expect(hostToWsl('/mnt/c/Users/x')).toBe('/mnt/c/Users/x');
  });

  it('hostToWsl is the inverse of wslToHost on win32 for /mnt paths', () => {
    if (!isWin) return; // wslToHost is a no-op off win32 by contract
    const host = 'C:/Users/Administrator/echoes_of_the_fallen/engine/core/Engine.cpp';
    const wsl = hostToWsl(host);
    expect(wsl).toBe('/mnt/c/Users/Administrator/echoes_of_the_fallen/engine/core/Engine.cpp');
    expect(wslToHost(wsl)).toBe(host);
  });

  it('round-trips an arbitrary drive both directions (lexical, platform-independent for hostToWsl)', () => {
    const wsl = '/mnt/e/some/deep/path.hpp';
    // hostToWsl(wslToHost(...)) only meaningful on win32 (wslToHost no-ops elsewhere)
    if (isWin) {
      expect(hostToWsl(wslToHost(wsl))).toBe(wsl);
    }
  });
});

describe('translateUri (LSP boundary host<->WSL)', () => {
  it("out: host file URI -> WSL file URI", () => {
    expect(translateUri('file:///C:/Users/x/a.cpp', 'out')).toBe('file:///mnt/c/Users/x/a.cpp');
  });
  it("in: WSL file URI -> host file URI (win32)", () => {
    if (!isWin) return; // wslToHost no-ops off win32
    expect(translateUri('file:///mnt/c/Users/x/a.cpp', 'in')).toBe('file:///C:/Users/x/a.cpp');
  });
  it('round-trips a returned location URI back to a Windows URI (win32)', () => {
    if (!isWin) return;
    const hostUri = 'file:///C:/Users/Administrator/echoes_of_the_fallen/engine/core/Engine.h';
    const sent = translateUri(hostUri, 'out');
    expect(sent).toBe('file:///mnt/c/Users/Administrator/echoes_of_the_fallen/engine/core/Engine.h');
    expect(translateUri(sent, 'in')).toBe(hostUri);
  });
  it('leaves non-file URIs and non-URIs untouched', () => {
    expect(translateUri('untitled:foo', 'out')).toBe('untitled:foo');
    expect(translateUri(undefined, 'out')).toBe(undefined);
    expect(translateUri('file:///usr/include/string', 'in')).toBe('file:///usr/include/string');
  });
});

describe('wslModeRequested', () => {
  it('true only for truthy opt-in values', () => {
    expect(wslModeRequested({ APG_CLANGD_WSL: '1' })).toBe(true);
    expect(wslModeRequested({ APG_CLANGD_WSL: 'true' })).toBe(true);
    expect(wslModeRequested({ APG_CLANGD_WSL: 'on' })).toBe(true);
    expect(wslModeRequested({ APG_CLANGD_WSL: 'yes' })).toBe(true);
  });
  it('false for unset / falsey', () => {
    expect(wslModeRequested({})).toBe(false);
    expect(wslModeRequested({ APG_CLANGD_WSL: '0' })).toBe(false);
    expect(wslModeRequested({ APG_CLANGD_WSL: 'false' })).toBe(false);
    expect(wslModeRequested({ APG_CLANGD_WSL: 'auto' })).toBe(false); // auto is not "requested explicit"
  });
});

describe('detectWslClangd (mocked spawn)', () => {
  beforeEach(() => _resetWslProbeCache());
  it('reports available + version when wsl.exe clangd --version succeeds', () => {
    if (!isWin) {
      expect(detectWslClangd().available).toBe(false); // not_win32 contract
      return;
    }
    const spawnImpl = (cmd, args) => {
      expect(cmd).toBe('wsl.exe');
      expect(args.slice(0, 2)).toEqual(['-e', 'clangd']);
      expect(args).toContain('--version');
      return { status: 0, stdout: 'Ubuntu clangd version 18.1.3\n' };
    };
    const r = detectWslClangd({ spawnImpl });
    expect(r.available).toBe(true);
    expect(r.version).toMatch(/clangd version 18/);
  });
  it('reports unavailable when the probe errors / non-zero', () => {
    if (!isWin) return;
    const r1 = detectWslClangd({ spawnImpl: () => ({ status: 1, stderr: '' }) });
    expect(r1.available).toBe(false);
    const r2 = detectWslClangd({ spawnImpl: () => ({ status: null, error: { code: 'ENOENT' } }) });
    expect(r2.available).toBe(false);
    expect(r2.reason).toBe('ENOENT');
  });
  it('honors APG_CLANGD_WSL_BIN override', () => {
    if (!isWin) return;
    let seenBin;
    detectWslClangd({
      env: { APG_CLANGD_WSL_BIN: '/usr/lib/llvm-18/bin/clangd' },
      spawnImpl: (_c, args) => { seenBin = args[1]; return { status: 0, stdout: 'x' }; }
    });
    expect(seenBin).toBe('/usr/lib/llvm-18/bin/clangd');
  });
});

describe('decideWslMode', () => {
  const wslOk = () => ({ available: true, version: 'clangd 18', bin: 'clangd' });
  const wslNo = () => ({ available: false, version: null, bin: 'clangd', reason: 'no_wsl' });

  it('not_requested when env unset (default OFF — Windows path untouched)', () => {
    const d = decideWslMode({ env: {}, detect: wslOk, compileDb: { foreignToolchain: true } });
    expect(d.use).toBe(false);
    expect(d.reason).toBe('not_requested');
  });

  it('opt-in explicit + WSL available => use', () => {
    if (!isWin) {
      // off win32 it can never engage
      expect(decideWslMode({ env: { APG_CLANGD_WSL: '1' }, detect: wslOk }).use).toBe(false);
      return;
    }
    const d = decideWslMode({ env: { APG_CLANGD_WSL: '1' }, detect: wslOk, compileDb: { found: true } });
    expect(d.use).toBe(true);
    expect(d.reason).toBe('opt_in_explicit');
  });

  it('opt-in explicit but WSL unavailable => no (safe fallback)', () => {
    if (!isWin) return;
    const d = decideWslMode({ env: { APG_CLANGD_WSL: '1' }, detect: wslNo, compileDb: { found: true } });
    expect(d.use).toBe(false);
    expect(d.reason).toBe('wsl_unavailable');
  });

  it('auto mode engages only for a foreign DB', () => {
    if (!isWin) return;
    const foreign = decideWslMode({ env: { APG_CLANGD_WSL: 'auto' }, detect: wslOk, compileDb: { foreignToolchain: true } });
    expect(foreign.use).toBe(true);
    expect(foreign.reason).toBe('auto_foreign_db');
    const native = decideWslMode({ env: { APG_CLANGD_WSL: 'auto' }, detect: wslOk, compileDb: { foreignToolchain: false } });
    expect(native.use).toBe(false);
    expect(native.reason).toBe('auto_native_db');
  });
});

describe('LspClient pathMode:wsl — boundary URI translation round-trips', () => {
  it('default (no pathMode) sends/returns host URIs untouched', async () => {
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///C:/r' });
    await client.start();
    const refs = await client.references('file:///C:/r/src/foo.cpp', { line: 0, character: 5 });
    expect(refs[0].uri).toBe('file:///C:/r/src/bar.cpp');
    await client.shutdown();
  });

  it('wsl mode: host URI sent in -> translated out; WSL URI returned -> translated back to host (win32)', async () => {
    if (!isWin) return; // wslToHost direction is a no-op off win32 by contract
    // The fake server echoes back whatever URI it receives (swapping
    // foo.cpp->bar.cpp). So if translation works, we send a host URI, the
    // server sees+echoes the WSL form, and the client hands us a host URI back.
    const client = new LspClient({
      command: process.execPath, args: [fakeServer],
      rootUri: 'file:///C:/r', pathMode: 'wsl'
    });
    // rootUri translated once at construction.
    expect(client.rootUri).toBe('file:///mnt/c/r');
    await client.start();
    const hostUri = 'file:///C:/Users/x/echoes/src/foo.cpp';
    const refs = await client.references(hostUri, { line: 0, character: 5 });
    // Returned location must be a Windows host URI (NOT /mnt/...).
    expect(refs[0].uri).toBe('file:///C:/Users/x/echoes/src/bar.cpp');
    expect(refs[0].uri).not.toContain('/mnt/');
    await client.shutdown();
  });

  it('wsl mode: definition result URI translated back to host (win32)', async () => {
    if (!isWin) return;
    const client = new LspClient({ command: process.execPath, args: [fakeServer], rootUri: 'file:///C:/r', pathMode: 'wsl' });
    await client.start();
    const defs = await client.definition('file:///C:/Users/x/a.cpp', { line: 0, character: 5 });
    expect(defs[0].uri).toBe('file:///C:/Users/x/a.cpp');
    await client.shutdown();
  });
});

describe('buildClangdSpawn — WSL transport arg construction (mocked detect)', () => {
  const wslOk = () => ({ available: true, version: 'clangd 18', bin: 'clangd' });

  it('default (no opt-in) keeps the Windows transport EXACTLY as-is', () => {
    const { command, args, pathMode } = buildClangdSpawn({
      env: {},
      detect: wslOk,
      compileDb: { found: true, foreignToolchain: true, normalizedDir: 'C:/r/.aify-graph/code-intel', sourceDir: 'C:/r/build-linux' }
    });
    expect(command).not.toBe('wsl.exe');
    expect(pathMode).toBeUndefined();
    // Windows transport: --query-driver + the NORMALIZED dir.
    expect(args).toContain('--query-driver=*');
    expect(args).toContain('--compile-commands-dir=C:/r/.aify-graph/code-intel');
  });

  it('opt-in => wsl.exe spawn pointing at the ORIGINAL Linux DB dir, no normalization, no query-driver', () => {
    if (!isWin) return; // WSL transport is win32-only
    const { command, args, pathMode } = buildClangdSpawn({
      env: { APG_CLANGD_WSL: '1' },
      detect: wslOk,
      compileDb: { found: true, foreignToolchain: true, normalizedDir: 'C:/r/.aify-graph/code-intel', sourceDir: 'C:/Users/x/echoes/build-linux' }
    });
    expect(command).toBe('wsl.exe');
    expect(pathMode).toBe('wsl');
    expect(args.slice(0, 2)).toEqual(['-e', 'clangd']);
    // points at the ORIGINAL Linux DB dir, mapped to /mnt
    expect(args).toContain('--compile-commands-dir=/mnt/c/Users/x/echoes/build-linux');
    // must NOT carry the Windows-normalized dir
    expect(args.some(a => a.includes('.aify-graph'))).toBe(false);
    // must NOT carry --query-driver (the real Linux toolchain resolves natively)
    expect(args.some(a => a.startsWith('--query-driver'))).toBe(false);
    // shared tuned flags still present
    expect(args).toContain('--background-index');
    expect(args).toContain('--pch-storage=memory');
  });
});
