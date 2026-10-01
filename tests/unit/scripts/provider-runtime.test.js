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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  deriveReporterId, readProviderConfig, dirtyRefusal, makeInstruments, REPORTER_ID_MAX,
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

describe('the host key is derived the way aify-env names the machine', () => {
  // The default was 'host-a', a fixture name from the evidence scripts. Any run without APG_DASHBOARD_HOST claimed
  // and swept as host-a, which is how the live project's root came to sit on a host no real machine reports.
  // aify-env names a machine `<platform>:<host>`, lowercased (the dashboard's bridge, d4a978d), and the host key is
  // the part after the colon, so a manual run must land where the aify-env plugin does.
  it('★★★ the default is the hostname, lowercased', () => {
    expect(readProviderConfig({}, WIN).hostKey).toBe('stevenz-l');
    expect(readProviderConfig({}, WSL).hostKey, 'WSL on the same PC is the same host').toBe('stevenz-l');
  });

  it('★★★ CONTROL: an explicit APG_DASHBOARD_HOST still wins', () => {
    expect(readProviderConfig({ APG_DASHBOARD_HOST: 'scratch-host' }, WIN).hostKey).toBe('scratch-host');
  });

  it('★★★ a machine with no usable hostname is refused, naming the override, not given a fixture name', () => {
    expect(() => readProviderConfig({}, { ...WIN, hostname: '' })).toThrow(/APG_DASHBOARD_HOST/u);
    expect(() => readProviderConfig({}, { ...WIN, hostname: 'has space' })).toThrow(/APG_DASHBOARD_HOST/u);
  });
});

describe('instruments can read a COMMIT instead of the working tree', () => {
  // Queued calls read the commit (`git show <head>:<path>`, amendment 2 of DESIGN-GRAPHS), so a developer's
  // uncommitted edits neither change the answer nor make the call fail.
  let repo;
  let head;
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  beforeAll(async () => {
    repo = await mkdtemp(join(tmpdir(), 'apg-at-commit-'));
    await mkdir(join(repo, 'src', 'dir'), { recursive: true });
    await writeFile(join(repo, 'src', 'a.js'), 'export function a() { return 1; }\n');
    await writeFile(join(repo, 'src', 'dir', 'b.js'), 'export function b() { return 2; }\n');
    git('init', '-q'); git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'c');
    head = git('rev-parse', 'HEAD');
    // The working tree now disagrees with the commit in every way that matters.
    await writeFile(join(repo, 'src', 'a.js'), 'export function a() { return 999; }\n');
    await rm(join(repo, 'src', 'dir', 'b.js'));
    await writeFile(join(repo, 'src', 'untracked.js'), 'export function u() {}\n');
  });
  afterAll(async () => { try { await rm(repo, { recursive: true, force: true }); } catch { /* win lock */ } });

  it('★★★ readSource returns the COMMITTED content, not the edited tree', () => {
    const at = makeInstruments(repo, { at: head });
    expect(at.readSource('src/a.js')).toContain('return 1;');
    // CONTROL: the default instruments read the tree, so the two really differ here.
    expect(makeInstruments(repo).readSource('src/a.js')).toContain('return 999;');
  });

  it('★★★ isPresent answers for the commit: a file deleted from the tree is still present', () => {
    const at = makeInstruments(repo, { at: head });
    expect(at.isPresent('src/dir/b.js')).toBe(true);
    expect(at.where).toContain(head.slice(0, 12));
  });

  it('★★★ CONTROL: absent at the commit is absent: untracked, wrong case, a directory, nonsense', () => {
    const at = makeInstruments(repo, { at: head });
    expect(at.isPresent('src/untracked.js'), 'only in the tree').toBe(false);
    expect(at.isPresent('src/A.js'), 'wrong case').toBe(false);
    expect(at.isPresent('src/dir'), 'a directory is not a file').toBe(false);
    expect(at.isPresent('src/nope.js')).toBe(false);
  });

  it('★★★ the default instruments do not inject presence, so a sweep still lists the tree', () => {
    expect(makeInstruments(repo).isPresent).toBeUndefined();
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
