import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  confirmFeature,
  confirmationStatus,
  CONFIRMATION_STATES,
  symbolKey,
} from '../../../mcp/stdio/overlay/confirmation.js';

const SOURCE = [
  'export function alpha(x) {',
  '  return x + 1;',
  '}',
  '',
  'export function beta(y) {',
  '  return y * 2;',
  '}',
  '',
].join('\n');

const FEATURE = { id: 'math', anchors: { symbols: ['alpha'], files: ['src/math.js'] } };
const AT = '2026-09-18T20:00:00.000Z';

describe('overlay/confirmation', () => {
  let repoRoot;

  async function put(rel, text) {
    await mkdir(join(repoRoot, rel, '..'), { recursive: true });
    await writeFile(join(repoRoot, rel), text);
  }

  async function edit(rel, from, to) {
    const text = await readFile(join(repoRoot, rel), 'utf8');
    if (!text.includes(from)) throw new Error(`fixture edit anchor missing: ${from}`);
    await writeFile(join(repoRoot, rel), text.replace(from, to));
  }

  function confirmed(feature = FEATURE) {
    return { ...feature, confirmed: confirmFeature(repoRoot, feature, { by: 'tester', at: AT }) };
  }

  beforeEach(async () => {
    repoRoot = await mkdtemp(join(tmpdir(), 'apg-confirm-'));
    await put('src/math.js', SOURCE);
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('a feature never confirmed is unconfirmed, not unchanged', () => {
    expect(confirmationStatus(repoRoot, FEATURE).state).toBe(CONFIRMATION_STATES.UNCONFIRMED);
  });

  it('the stamp records who, when, and a hash per anchored symbol and file', () => {
    const stamp = confirmFeature(repoRoot, FEATURE, { by: 'tester', at: AT });
    expect(stamp.by).toBe('tester');
    expect(stamp.at).toBe(AT);
    expect(Object.keys(stamp.symbols)).toEqual([symbolKey('src/math.js', 'alpha')]);
    expect(Object.keys(stamp.files)).toEqual(['src/math.js']);
  });

  it('confirming requires a name, so a stamp always says who vouched', () => {
    expect(() => confirmFeature(repoRoot, FEATURE, { at: AT })).toThrow(/`by` is required/u);
  });

  it('nothing edited: unchanged, with no changes listed', () => {
    const status = confirmationStatus(repoRoot, confirmed());
    expect(status.state).toBe(CONFIRMATION_STATES.UNCHANGED);
    expect(status.changes).toEqual([]);
    expect(status.at).toBe(AT);
  });

  it('an edit inside an anchored symbol: changed, naming the symbol', async () => {
    const feature = confirmed();
    await edit('src/math.js', 'return x + 1;', 'return x + 2;');
    const status = confirmationStatus(repoRoot, feature);
    expect(status.state).toBe(CONFIRMATION_STATES.CHANGED);
    expect(status.changes).toContainEqual({ kind: 'symbols', anchor: symbolKey('src/math.js', 'alpha'), change: 'changed' });
  });

  it('an edit to a NEIGHBOUR in the same file: reported as a file change, state stays unchanged', async () => {
    const feature = confirmed();
    await edit('src/math.js', 'return y * 2;', 'return y * 3;');
    const status = confirmationStatus(repoRoot, feature);
    expect(status.state).toBe(CONFIRMATION_STATES.UNCHANGED);
    expect(status.changes).toEqual([{ kind: 'files', anchor: 'src/math.js', change: 'changed' }]);
  });

  it('an anchored symbol deleted: changed, with the symbol reported gone', async () => {
    const feature = confirmed();
    await edit('src/math.js', 'export function alpha(x) {\n  return x + 1;\n}\n', '');
    const status = confirmationStatus(repoRoot, feature);
    expect(status.state).toBe(CONFIRMATION_STATES.CHANGED);
    expect(status.changes).toContainEqual({ kind: 'symbols', anchor: symbolKey('src/math.js', 'alpha'), change: 'gone' });
    expect(status.unwatched).toContainEqual({ anchor: 'alpha', reason: 'not defined in any literal anchored file' });
  });

  it('line endings converted to CRLF: unchanged', async () => {
    const feature = confirmed();
    await writeFile(join(repoRoot, 'src/math.js'), SOURCE.replace(/\n/gu, '\r\n'));
    expect(confirmationStatus(repoRoot, feature).state).toBe(CONFIRMATION_STATES.UNCHANGED);
  });

  it('an anchor added after confirming: changed, as not in the confirmation', () => {
    const feature = confirmed();
    const widened = { ...feature, anchors: { ...feature.anchors, symbols: ['alpha', 'beta'] } };
    const status = confirmationStatus(repoRoot, widened);
    expect(status.state).toBe(CONFIRMATION_STATES.CHANGED);
    expect(status.changes).toContainEqual({ kind: 'symbols', anchor: symbolKey('src/math.js', 'beta'), change: 'not-in-confirmation' });
  });

  it('what cannot be watched is named, with the reason, rather than passed silently', () => {
    const feature = {
      id: 'wide',
      anchors: { symbols: ['alpha', 'nowhere'], files: ['src/math.js', 'src/*', '../outside.js'] },
    };
    const { unwatched } = confirmationStatus(repoRoot, feature);
    expect(unwatched).toEqual([
      { anchor: 'src/*', reason: 'glob file anchors are not watched' },
      { anchor: '../outside.js', reason: 'outside the repository' },
      { anchor: 'nowhere', reason: 'not defined in any literal anchored file' },
    ]);
  });

  it('a feature with only file anchors is decided by its files, so it can still ping', async () => {
    const filesOnly = { id: 'cfg', anchors: { symbols: [], files: ['src/math.js'] } };
    const feature = confirmed(filesOnly);
    expect(confirmationStatus(repoRoot, feature).basis).toBe('files');
    await edit('src/math.js', 'return y * 2;', 'return y * 3;');
    expect(confirmationStatus(repoRoot, feature).state).toBe(CONFIRMATION_STATES.CHANGED);
  });

  it('a Python symbol is watched the same way', async () => {
    await put('svc/app.py', 'def handle(req):\n    return 200\n\n\ndef other():\n    return 1\n');
    const feature = confirmed({ id: 'py', anchors: { symbols: ['handle'], files: ['svc/app.py'] } });
    await edit('svc/app.py', 'return 200', 'return 201');
    const status = confirmationStatus(repoRoot, feature);
    expect(status.state).toBe(CONFIRMATION_STATES.CHANGED);
    expect(status.changes).toContainEqual({ kind: 'symbols', anchor: symbolKey('svc/app.py', 'handle'), change: 'changed' });
  });
});
