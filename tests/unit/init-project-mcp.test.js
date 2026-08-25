// Plan #20 tests: init-project-mcp.mjs writes/merges project-local MCP
// config without clobbering sibling MCP servers, refuses to infer
// runtime, and rejects unsupported runtimes per senior-dev's lock.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { mergeAifyEntry, mergeSessionStartHook, parseJsonRelaxed } from '../../scripts/init-project-mcp.mjs';

const SCRIPT = path.resolve('scripts/init-project-mcp.mjs');

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'apg-init-mcp-'));
}

function runScript(args, opts = {}) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      ...opts,
    });
    return { ok: true, stdout, status: 0 };
  } catch (err) {
    return { ok: false, stdout: err.stdout?.toString?.() ?? '', stderr: err.stderr?.toString?.() ?? '', status: err.status ?? -1 };
  }
}

describe('init-project-mcp.mjs — runtime gate', () => {
  it('requires --runtime and --project-root', () => {
    const r = runScript([]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/Usage:/);
  });

  it('rejects unknown runtime', () => {
    const dir = tmpProject();
    const r = runScript(['--runtime', 'jetbrains', '--project-root', dir]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/unknown runtime/);
  });

  it('rejects docs-only runtimes with pointer to install.<runtime>.md', () => {
    const dir = tmpProject();
    for (const runtime of ['codex', 'hermes', 'opencode', 'pi-linux']) {
      const r = runScript(['--runtime', runtime, '--project-root', dir]);
      expect(r.ok).toBe(false);
      expect(r.stderr).toMatch(/user-level/);
      expect(r.stderr).toMatch(new RegExp(`install\\.${runtime}\\.md`));
    }
  });

  it('rejects non-existent project-root', () => {
    const r = runScript(['--runtime', 'claude-code', '--project-root', '/nonexistent/path/abc']);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/project-root does not exist/);
  });
});

describe('init-project-mcp.mjs — claude-code write', () => {
  it('writes .mcp.json with the aify entry when fresh', () => {
    const dir = tmpProject();
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toMatch(/Wrote/);
    const written = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    expect(written.mcpServers['aify-project-graph']).toBeDefined();
    expect(written.mcpServers['aify-project-graph'].type).toBe('stdio');
    expect(written.mcpServers['aify-project-graph'].command).toBe('node');
    expect(written.mcpServers['aify-project-graph'].args.join(' ')).toMatch(/server\.js/);
  });

  it('emits the claude-code trust-approval note', () => {
    const dir = tmpProject();
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir]);
    expect(r.stdout).toMatch(/trust approval/i);
  });

  it('uses env-expansion in the path so APG_PLUGIN_ROOT can override', () => {
    const dir = tmpProject();
    runScript(['--runtime', 'claude-code', '--project-root', dir]);
    const written = JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8'));
    const arg = written.mcpServers['aify-project-graph'].args.find(a => a.includes('server.js'));
    expect(arg).toMatch(/\$\{APG_PLUGIN_ROOT:-/);
  });
});

describe('init-project-mcp.mjs — cursor write', () => {
  it('writes .cursor/mcp.json (creating the .cursor dir)', () => {
    const dir = tmpProject();
    const r = runScript(['--runtime', 'cursor', '--project-root', dir]);
    expect(r.ok).toBe(true);
    const cfgPath = path.join(dir, '.cursor', 'mcp.json');
    expect(fs.existsSync(cfgPath)).toBe(true);
    const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(written.mcpServers['aify-project-graph']).toBeDefined();
  });
});

describe('init-project-mcp.mjs — idempotent merge', () => {
  it('preserves sibling MCP servers when merging into existing .mcp.json', () => {
    const dir = tmpProject();
    const cfgPath = path.join(dir, '.mcp.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      mcpServers: {
        'other-team-mcp': { command: 'node', args: ['/other/path/server.js'] },
      },
    }));
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir]);
    expect(r.ok).toBe(true);
    const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(written.mcpServers['other-team-mcp']).toBeDefined();
    expect(written.mcpServers['other-team-mcp'].command).toBe('node');
    expect(written.mcpServers['aify-project-graph']).toBeDefined();
  });

  it('overwrites an existing aify-project-graph entry without touching siblings', () => {
    const dir = tmpProject();
    const cfgPath = path.join(dir, '.mcp.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      mcpServers: {
        'aify-project-graph': { command: '/old/node', args: ['/old/server.js'] },
        'sidekick': { command: 'node', args: ['/keep/me/server.js'] },
      },
    }));
    runScript(['--runtime', 'claude-code', '--project-root', dir]);
    const written = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    expect(written.mcpServers['sidekick'].args[0]).toBe('/keep/me/server.js');
    // aify entry has been updated (new shape now has `type: stdio`)
    expect(written.mcpServers['aify-project-graph'].type).toBe('stdio');
    expect(written.mcpServers['aify-project-graph'].command).toBe('node');
  });

  it('refuses to overwrite when existing .mcp.json is invalid JSON', () => {
    const dir = tmpProject();
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{not-valid-json');
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir]);
    expect(r.ok).toBe(false);
    expect(r.stderr).toMatch(/not valid JSON/);
  });

  it('is idempotent — running twice produces the same file content', () => {
    const dir = tmpProject();
    runScript(['--runtime', 'claude-code', '--project-root', dir]);
    const first = fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8');
    runScript(['--runtime', 'claude-code', '--project-root', dir]);
    const second = fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8');
    expect(first).toBe(second);
  });
});

describe('init-project-mcp.mjs — --check mode', () => {
  it('prints the would-write envelope without touching disk', () => {
    const dir = tmpProject();
    const cfgPath = path.join(dir, '.mcp.json');
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir, '--check']);
    expect(r.ok).toBe(true);
    const out = JSON.parse(r.stdout);
    expect(out.mode).toBe('check');
    expect(out.runtime).toBe('claude-code');
    expect(out.wouldWrite.mcpServers['aify-project-graph']).toBeDefined();
    expect(fs.existsSync(cfgPath)).toBe(false);
  });
});

describe('init-project-mcp.mjs — SessionStart discoverability hook (Sand Castle P0 #1)', () => {
  it('wires the SessionStart hint into .claude/settings.json for claude-code by default', () => {
    const dir = tmpProject();
    const r = runScript(['--runtime', 'claude-code', '--project-root', dir]);
    expect(r.ok).toBe(true);
    expect(r.stdout).toMatch(/SessionStart discoverability hint/);
    const settings = JSON.parse(fs.readFileSync(path.join(dir, '.claude', 'settings.json'), 'utf8'));
    const cmds = settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command));
    expect(cmds.some((c) => c.includes('session-start-hint.mjs'))).toBe(true);
  });

  it('--no-hint-hook skips the hook (only .mcp.json written)', () => {
    const dir = tmpProject();
    runScript(['--runtime', 'claude-code', '--project-root', dir, '--no-hint-hook']);
    expect(fs.existsSync(path.join(dir, '.claude', 'settings.json'))).toBe(false);
  });

  it('does NOT wire the hook for cursor (no equivalent SessionStart surface)', () => {
    const dir = tmpProject();
    runScript(['--runtime', 'cursor', '--project-root', dir]);
    expect(fs.existsSync(path.join(dir, '.claude', 'settings.json'))).toBe(false);
  });

  it('is idempotent + preserves existing hooks (mergeSessionStartHook unit)', () => {
    const existing = { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo other' }] }] } };
    const first = mergeSessionStartHook(existing, '/abs/plugin');
    expect(first.added).toBe(true);
    expect(first.settings.hooks.SessionStart).toHaveLength(2); // kept the existing one
    const second = mergeSessionStartHook(first.settings, '/abs/plugin');
    expect(second.added).toBe(false); // already present → no duplicate
    expect(second.settings.hooks.SessionStart).toHaveLength(2);
  });
});

describe('mergeAifyEntry (unit)', () => {
  it('handles null existing config', () => {
    const merged = mergeAifyEntry(null, '/abs/plugin');
    expect(merged.mcpServers['aify-project-graph']).toBeDefined();
  });

  it('handles existing config without mcpServers', () => {
    const merged = mergeAifyEntry({ foo: 'bar' }, '/abs/plugin');
    expect(merged.foo).toBe('bar');
    expect(merged.mcpServers['aify-project-graph']).toBeDefined();
  });

  it('uses forward slashes in the env-expansion default', () => {
    const merged = mergeAifyEntry({}, 'C:\\Docker\\aify-project-graph');
    const arg = merged.mcpServers['aify-project-graph'].args.find(a => a.includes('server.js'));
    expect(arg).not.toMatch(/\\\\/);
    expect(arg).toMatch(/C:\/Docker\/aify-project-graph/);
  });
});

// P2-8 — config-write safety. "Absent" and "unparseable" must take DIFFERENT
// branches: absent may be created, unparseable must abort rather than silently
// overwrite a config whose other entries (mcpServers, hooks, theme) we would
// destroy. The BOM case matters on Windows specifically: editors and PowerShell
// redirection write UTF-8 with a leading BOM constantly and JSON.parse rejects
// it, so treating that as "unparseable" would abort the install on a perfectly
// valid config.
describe('config parsing safety', () => {
  it('parses JSON that carries a UTF-8 BOM', () => {
    const parsed = parseJsonRelaxed('\uFEFF{"mcpServers":{"other":{"command":"node"}}}', 'x.json');
    expect(parsed.mcpServers.other.command).toBe('node');
  });

  it('still refuses genuinely malformed JSON, naming the file', () => {
    expect(() => parseJsonRelaxed('{ not json', 'C:/repo/.mcp.json'))
      .toThrow(/is not valid JSON/);
  });
});

// ⭐ THE MID-TASK REACH LEVER'S INSTALL PATH. The rule logic behind this hook existed, was tested,
// and was described in the roadmap as "LIVE" while having ZERO production callers — "live" meant
// the logic ran, not that anything invoked it. Shipping a hook with no way to install it would be
// that same defect one layer out, so the install path is tested as its own thing.
//
// ⚠ OPT-IN by design. The roadmap records placement of this hook as the operator's decision, and it
// is more intrusive than the SessionStart hint: it injects text mid-task rather than once at start.
// A measured-low fire rate (4.8% upper bound vs 85.5% for the disqualified variant) argues for
// OFFERING it, not for enabling it on someone's behalf.
describe('mergeDeletionGuardHook — the PostToolUse install path', () => {
  it('adds a PostToolUse entry scoped to the editing tools', async () => {
    const { mergeDeletionGuardHook } = await import('../../scripts/init-project-mcp.mjs');
    const r = mergeDeletionGuardHook({}, '/plugin');
    expect(r.added).toBe(true);
    const group = r.settings.hooks.PostToolUse[0];
    expect(group.matcher).toBe('Edit|Write|MultiEdit');
    expect(group.hooks[0].command).toContain('post-edit-deletion-guard.mjs');
  });

  it('⛔ IDEMPOTENT EVEN WHEN THE PLUGIN ROOT MOVES — identity is the script name', () => {
    // The command embeds an absolute path. Matching on the whole string would install a SECOND copy
    // every time the repo is cloned elsewhere, and a hook that fires twice per edit turns a rare
    // signal into noise — which is the one failure mode this whole rule was measured to avoid.
    return import('../../scripts/init-project-mcp.mjs').then(({ mergeDeletionGuardHook }) => {
      const first = mergeDeletionGuardHook({}, '/plugin-a');
      const second = mergeDeletionGuardHook(first.settings, '/somewhere-completely-different');
      expect(second.added).toBe(false);
      expect(second.settings.hooks.PostToolUse).toHaveLength(1);
    });
  });

  it('coexists with the SessionStart hint rather than replacing it', async () => {
    const { mergeDeletionGuardHook, mergeSessionStartHook } = await import('../../scripts/init-project-mcp.mjs');
    const withGuard = mergeDeletionGuardHook({}, '/plugin');
    const withBoth = mergeSessionStartHook(withGuard.settings, '/plugin');
    expect(Object.keys(withBoth.settings.hooks).sort()).toEqual(['PostToolUse', 'SessionStart']);
    expect(withBoth.settings.hooks.PostToolUse).toHaveLength(1);
    expect(withBoth.settings.hooks.SessionStart).toHaveLength(1);
  });

  it('⛔ preserves unrelated settings and unrelated hooks', async () => {
    const { mergeDeletionGuardHook } = await import('../../scripts/init-project-mcp.mjs');
    const existing = { model: 'opus', hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'somebody-elses.sh' }] }] } };
    const r = mergeDeletionGuardHook(existing, '/plugin');
    expect(r.settings.model).toBe('opus');
    expect(r.settings.hooks.PreToolUse[0].hooks[0].command).toBe('somebody-elses.sh');
  });
});
