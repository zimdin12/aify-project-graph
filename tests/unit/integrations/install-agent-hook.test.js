import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { withHook, hasHook, HOOK_COMMAND, MATCHER } from '../../../scripts/install-agent-hook.mjs';

// ⛔ THE LAST STEP OF A CAPABILITY MUST NOT BE A MANUAL EDIT.
//
// The deletion-guard hook is the ONE mid-task mechanism this project has measured as worth sending,
// it was built and tested as a real process — and then sat unwired, because enabling it meant
// hand-editing settings.json. That is the same shape as this repo's other reach failures:
// `sync-skills.mjs` mirrors inside the repo and never installs; the docs layer was reachable only by
// an argument nobody knew to pass. A capability whose last step is manual is one most people do not
// have.
//
// ⚠ AND A CORRUPT settings.json BREAKS THE HOST ENTIRELY. That makes the write path, not the merge
// logic, the dangerous part — so it is driven here as a REAL PROCESS against real files, and the
// unparseable-input case is asserted to REFUSE rather than overwrite.

const SCRIPT = resolve('scripts/install-agent-hook.mjs');
const run = (args, expectFailure = false) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' }) };
  } catch (err) {
    if (!expectFailure) throw err;
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

describe('install-agent-hook — the merge is pure and idempotent', () => {
  it('⭐ POSITIVE CONTROL: an empty settings object does NOT already have the hook', () => {
    // Without this, every assertion below is satisfied by a `hasHook` that always returns true.
    expect(hasHook({})).toBe(false);
    expect(hasHook({ hooks: {} })).toBe(false);
    expect(hasHook({ hooks: { PostToolUse: [] } })).toBe(false);
  });

  it('⛔ adds the hook to an empty settings object', () => {
    const next = withHook({});
    expect(hasHook(next)).toBe(true);
    const group = next.hooks.PostToolUse.find((g) => g.matcher === MATCHER);
    expect(group.hooks[0].command).toBe(HOOK_COMMAND);
  });

  it('⛔ IDEMPOTENT: installing twice leaves exactly one hook', () => {
    // A second copy would double every message an agent sees, which is the fastest way to teach it
    // to ignore the channel.
    const once = withHook({});
    const twice = withHook(once);
    const all = twice.hooks.PostToolUse.flatMap((g) => g.hooks);
    expect(all.filter((h) => h.command.includes('post-edit-deletion-guard'))).toHaveLength(1);
  });

  it('⛔ PRESERVES unrelated settings and unrelated hooks', () => {
    // The file belongs to the user. Anything this script does not understand must survive untouched.
    const before = {
      model: 'opus',
      permissions: { allow: ['Bash'] },
      hooks: {
        PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo other' }] }],
        SessionStart: [{ hooks: [{ type: 'command', command: 'echo start' }] }],
      },
    };
    const after = withHook(before);
    expect(after.model).toBe('opus');
    expect(after.permissions).toEqual({ allow: ['Bash'] });
    expect(after.hooks.SessionStart).toEqual(before.hooks.SessionStart);
    expect(after.hooks.PostToolUse.some((g) => g.matcher === 'Bash')).toBe(true);
    expect(hasHook(after)).toBe(true);
  });

  it('⛔ reuses an existing group with the SAME matcher rather than adding a rival', () => {
    const before = { hooks: { PostToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: 'echo mine' }] }] } };
    const after = withHook(before);
    expect(after.hooks.PostToolUse.filter((g) => g.matcher === MATCHER)).toHaveLength(1);
    expect(after.hooks.PostToolUse[0].hooks).toHaveLength(2);
  });

  it('⛔ does not MUTATE the input — a caller may want to diff before writing', () => {
    const before = { hooks: { PostToolUse: [] } };
    const snapshot = JSON.stringify(before);
    withHook(before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('install-agent-hook — driven as a real process against real files', () => {
  let dir;
  let settings;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apg-hookinstall-'));
    settings = join(dir, 'settings.json');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  it('⛔ --check exits 1 when absent and 0 once installed', () => {
    writeFileSync(settings, '{}');
    expect(run(['--check', '--settings', settings], true).code).toBe(1);
    expect(run(['--settings', settings]).code).toBe(0);
    expect(run(['--check', '--settings', settings]).code).toBe(0);
  });

  it('⛔ the file on disk is valid JSON containing the hook', () => {
    // ⚠ Re-parsing the BYTES, not the object the script intended to write. The failure guarded
    // against is a settings file the host can no longer read.
    writeFileSync(settings, JSON.stringify({ model: 'opus' }, null, 2));
    run(['--settings', settings]);
    const parsed = JSON.parse(readFileSync(settings, 'utf8'));
    expect(parsed.model, 'unrelated settings must survive').toBe('opus');
    expect(hasHook(parsed)).toBe(true);
  });

  it('⛔ a BACKUP is written before an existing file is modified', () => {
    writeFileSync(settings, JSON.stringify({ model: 'opus' }));
    run(['--settings', settings]);
    expect(existsSync(`${settings}.apg-bak`)).toBe(true);
    expect(JSON.parse(readFileSync(`${settings}.apg-bak`, 'utf8')).model).toBe('opus');
  });

  it('⛔ REFUSES an unparseable settings file rather than overwriting it', () => {
    // The dangerous case: a file we cannot read is one whose contents we cannot afford to destroy.
    const corrupt = '{ this is not json';
    writeFileSync(settings, corrupt);
    const r = run(['--settings', settings], true);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not valid JSON/);
    expect(readFileSync(settings, 'utf8'), 'the file must be untouched').toBe(corrupt);
  });

  it('⛔ creates the file when none exists, and writes no backup for it', () => {
    const fresh = join(dir, 'nested', 'settings.json');
    expect(run(['--settings', fresh]).code).toBe(0);
    expect(hasHook(JSON.parse(readFileSync(fresh, 'utf8')))).toBe(true);
    expect(existsSync(`${fresh}.apg-bak`), 'nothing existed to back up').toBe(false);
  });

  it('⭐ IDEMPOTENT AS A PROCESS: a second run changes the file not at all', () => {
    writeFileSync(settings, '{}');
    run(['--settings', settings]);
    const after1 = readFileSync(settings, 'utf8');
    run(['--settings', settings]);
    expect(readFileSync(settings, 'utf8')).toBe(after1);
  });

  it('⭐ THE COMMAND IT INSTALLS ACTUALLY EXISTS', () => {
    // A hook entry pointing at a missing script is a silent no-op — the exact failure this whole
    // installer exists to prevent, reintroduced one level down.
    const path = HOOK_COMMAND.replace(/^node /, '');
    expect(existsSync(path), `hook script missing: ${path}`).toBe(true);
  });
});
