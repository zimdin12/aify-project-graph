// ⛔⛔ A REPORTER NAME MUST TELL TWO INSTALLS APART, AND A SWEEP MUST NOT NAME A COMMIT IT DID NOT MEASURE.
//
// Agreed with the dashboard on 2026-10-01 for sweep identity ("Step 3" in their DESIGN-QUIET-ANCHORS at 92bb8c7):
//
// 1. The reporter id was the constant `aify-project-graph`. The service keeps one cursor per (project, reporter),
//    so Windows and WSL on one hostname, or two clones on one machine, would share a cursor. Each would then see
//    the other's sweeps as its own history, and a stale sweep from one could pass as current for the other. The
//    name is now derived from hostname, platform (WSL told apart from Linux) and the install path, hashed so no
//    path reaches a card. Their limit: at most 128 characters, printable, no control characters.
//
// 2. A sweep reads the working TREE and its batch names the COMMIT. With uncommitted edits those differ, and the
//    service cannot see the tree, so a dirty run is refused unless the caller says --allow-dirty. That goes for
//    reconfirm too, where it matters more: a baseline taken from uncommitted code persists.
import { describe, it, expect } from 'vitest';
import {
  deriveReporterId, readProviderConfig, dirtyRefusal, REPORTER_ID_MAX,
} from '../../../scripts/lib/provider-runtime.mjs';

const WIN = Object.freeze({ hostname: 'StevenZ-L', platform: 'win32', isWsl: false, installPath: 'C:\\Users\\a\\.claude\\plugins\\aify-project-graph' });
const WSL = Object.freeze({ hostname: 'StevenZ-L', platform: 'linux', isWsl: true, installPath: '/home/a/.codex/plugins/aify-project-graph' });

describe('the reporter id is derived, and tells installs apart', () => {
  it('★★★ Windows and WSL on ONE hostname derive DIFFERENT names', () => {
    const win = deriveReporterId(WIN);
    const wsl = deriveReporterId(WSL);
    expect(win).not.toBe(wsl);
    expect(win).toMatch(/^apg@StevenZ-L\/win32\/[0-9a-f]{8}$/u);
    expect(wsl).toMatch(/^apg@StevenZ-L\/wsl\/[0-9a-f]{8}$/u);
  });

  it('★★★ two clones on one machine and platform derive DIFFERENT names', () => {
    // The platform alone would not separate these. Only the install path does.
    const other = { ...WIN, installPath: 'C:\\Docker\\aify-project-graph' };
    expect(deriveReporterId(other)).not.toBe(deriveReporterId(WIN));
  });

  it('★★★ CONTROL: one install derives ONE name, however its path is spelled', () => {
    // A restarted provider must continue the same cursor. On Windows the same directory can arrive with either
    // slash and any case, and those must not become two reporters.
    const respelled = { ...WIN, installPath: 'c:/users/A/.claude/plugins/AIFY-project-graph/' };
    expect(deriveReporterId(respelled)).toBe(deriveReporterId(WIN));
    // ...but on Linux case is significant, so the same respelling there is a different install.
    const linuxA = { ...WSL, isWsl: false, installPath: '/opt/apg' };
    const linuxB = { ...WSL, isWsl: false, installPath: '/opt/APG' };
    expect(deriveReporterId(linuxA)).not.toBe(deriveReporterId(linuxB));
  });

  it('★★★ the path itself never appears in the name', () => {
    expect(deriveReporterId(WIN)).not.toContain('plugins');
    expect(deriveReporterId(WSL)).not.toContain('home');
  });

  it('★★★ a name the service would refuse is refused HERE, with the way out named', () => {
    // Fails closed rather than truncating: a truncated name could collide with another install's.
    expect(() => deriveReporterId({ ...WIN, hostname: 'h'.repeat(REPORTER_ID_MAX) })).toThrow(/APG_DASHBOARD_REPORTER/u);
    expect(() => deriveReporterId({ ...WIN, hostname: `bad${String.fromCharCode(7)}host` })).toThrow(/APG_DASHBOARD_REPORTER/u);
    expect(() => deriveReporterId({ ...WIN, hostname: '' })).toThrow(/APG_DASHBOARD_REPORTER/u);
    // CONTROL: the longest hostname that still fits is accepted, so the guard is a limit and not a wall.
    const room = REPORTER_ID_MAX - 'apg@/win32/12345678'.length;
    expect(deriveReporterId({ ...WIN, hostname: 'h'.repeat(room) })).toHaveLength(REPORTER_ID_MAX);
  });

  it('★★★ readProviderConfig uses the derived name, and an explicit APG_DASHBOARD_REPORTER still wins', () => {
    expect(readProviderConfig({}, WIN).reporterId).toBe(deriveReporterId(WIN));
    expect(readProviderConfig({ APG_DASHBOARD_REPORTER: 'apg-v09-proof' }, WIN).reporterId).toBe('apg-v09-proof');
  });
});

describe('a dirty tree is refused unless the caller says otherwise', () => {
  it('★★★ uncommitted paths refuse, and the refusal says why and how to override', () => {
    const refusal = dirtyRefusal({ dirty: 3, allowDirty: false, act: 'sweep' });
    expect(refusal).toMatch(/3 uncommitted path/u);
    expect(refusal).toMatch(/--allow-dirty/u);
  });

  it('★★★ CONTROL: a clean tree, or an explicit --allow-dirty, is not refused', () => {
    // Without these the refusal above proves nothing: a function that refused everything would pass it.
    expect(dirtyRefusal({ dirty: 0, allowDirty: false, act: 'sweep' })).toBeNull();
    expect(dirtyRefusal({ dirty: 3, allowDirty: true, act: 'sweep' })).toBeNull();
  });

  it('★★★ a missing count is refused, not read as clean', () => {
    // A guard that passes when its input is missing is decoration.
    expect(dirtyRefusal({ dirty: undefined, allowDirty: false, act: 'reconfirm' })).toMatch(/could not/u);
  });
});
