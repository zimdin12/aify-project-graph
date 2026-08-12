// THE WARNING MUST BE RENDERED FROM THE SCHEMA, NOT MERELY MATCH IT.
//
// ⛔ SELF-REVIEW SURVIVOR M5, found by mutating my own work before the reviewer reached it.
//
// The schema test asserts the emitted claim FRAGMENTS appear in order. But if production
// stops calling `renderClaim` and inlines the same sentence, the output is byte-identical
// and every assertion still passes. I replaced one `renderClaim(...)` call with its literal
// text and the whole suite stayed green.
//
// ⇒ That is not a cosmetic difference. The schema's entire value is that claims are
// ENUMERABLE — you can list what the warning may assert. An inlined copy is invisible to
// that list, drifts from it silently, and re-creates the template-literal problem the
// schema was built to end. Behavioural equivalence today is exactly how a divergence
// starts.
//
// ★ So this checks the DEPENDENCY, not the text: production must actually consult the
// renderer, once per claim its route declares. Same shape as route authority — proving the
// path was taken rather than that the answer looked right.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let head = 'aaaaaaa';
let diffFiles = ['docs/notes.md'];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    execFileSync: (cmd, args, opts) => {
      if (cmd === 'git' && Array.isArray(args)) {
        if (args.includes('rev-parse')) return `${head}\n`;
        if (args.includes('status')) return '';
        if (args.includes('diff')) {
          if (diffFiles === null) throw new Error('git diff unavailable');
          return diffFiles.join('\n');
        }
      }
      return actual.execFileSync(cmd, args, opts);
    },
  };
});

// Records which claim IDs production asks the renderer for, while keeping the REAL
// rendering so the emitted warning is unchanged and the other suites stay meaningful.
const rendered = [];
vi.mock('../../../mcp/stdio/stale-warning-claims.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    renderClaim: (id, bound) => { rendered.push(id); return actual.renderClaim(id, bound); },
  };
});

const { staleProcessWarning, _resetServerBuildCache } =
  await import('../../../mcp/stdio/server-build.js');
const { CLAIM } = await import('../../../mcp/stdio/stale-warning-claims.js');

beforeEach(() => {
  head = 'bbbbbbb'; diffFiles = ['docs/notes.md'];
  rendered.length = 0;
  _resetServerBuildCache();
});
afterEach(() => { head = 'aaaaaaa'; _resetServerBuildCache(); });

describe('the emitted warning is produced BY the claim schema', () => {
  it('★★ production consults the renderer for every claim it emits', () => {
    const w = staleProcessWarning();
    expect(w, 'harness sanity: the moved tree must produce a warning').toBeTruthy();

    // The claims the warning is built from. If any is inlined instead of rendered, its id
    // never reaches this list and the schema has quietly stopped being the source.
    for (const id of [
      CLAIM.PROCESS_RESTART_REQUIRED,
      CLAIM.HOST_METHOD_UNKNOWN,
      CLAIM.SESSION_RESTART_MAY_NOT_RESPAWN,
      CLAIM.VERIFY_BY_STARTED_AT,
      CLAIM.COMMIT_NOT_RESTART_IDENTITY,
    ]) {
      expect(rendered, `claim "${id}" must be RENDERED, not inlined — an inlined copy is `
        + 'invisible to the schema and drifts from it silently').toContain(id);
    }
  });

  it('★★ it renders nothing the schema does not define', () => {
    staleProcessWarning();

    const known = new Set(Object.values(CLAIM));
    const unknown = rendered.filter((id) => !known.has(id));
    expect(unknown, 'every rendered id must be a declared claim').toEqual([]);
  });

  it('★ the recorder itself is live — it would notice if nothing were rendered', () => {
    // Without this, a spy that never fires would satisfy `toContain` vacuously... it would
    // not, but the inverse matters: an empty recorder must be distinguishable from a
    // populated one, or the case above proves nothing about wiring.
    expect(rendered.length, 'harness sanity: before any call, nothing is recorded').toBe(0);
    staleProcessWarning();
    expect(rendered.length, 'and the warning must drive real renderer calls').toBeGreaterThan(3);
  });
});
