import { describe, it, expect } from 'vitest';
import {
  evaluateEdit,
  editedFilesFromPayload,
  isEditTool,
  renderFindings,
} from '../../../scripts/lib/deletion-guard.mjs';

// ⭐ THE MID-TASK REACH LEVER, finally wired. Every adoption measurement on this project says the
// same thing: entry-point reach works, mid-task reach does not — 12 of 17 skills never invoked,
// 7 of 1,049 subagent transcripts calling a graph verb, three of five agents TOLD to use the tools
// calling none. A hook does not require the agent to reach, which is why it beats every attempt to
// persuade one that is otherwise routing correctly.
//
// ⛔ AND IT IS THE HIGHEST SLOP RISK IN THE PROJECT. Measured before anything was built:
//     rule A "here are the callers"      85.5% of edits   DEAD — adds data, contradicts nothing
//     rule B "deleted, and still called"  4.8% (bound)    VIABLE — a contradiction
//
// ⛔⛔ THE RULE LOGIC HAS EXISTED AND BEEN INERT. `mcp/stdio/analysis/deleted-with-callers.js` was
// built, tested, and described in the roadmap as "LIVE" while having ZERO production callers —
// measured, against a positive control proving the search works. "Live" meant the logic ran, not
// that anything invoked it. These tests are about the DECISION a real hook makes, because testing
// the rule again would repeat exactly the mistake that left it unreachable.

const editPayload = (file = '/repo/src/lib.js') => ({ tool_name: 'Edit', tool_input: { file_path: file } });

const deps = (over = {}) => ({
  payload: editPayload(),
  repoRoot: '/repo',
  isApgRepo: () => true,
  diffFor: () => '-export function target() {}\n',
  removedDeclarations: () => [{ name: 'target', exported: true }],
  findFindings: () => [{ symbol: 'target', callers: [{ file: 'src/other.js', caller: 'uses' }], message: 'x' }],
  ...over,
});

describe('evaluateEdit — fires ONLY on a contradiction, and stays silent on everything else', () => {
  it('⭐ FIRES when a deleted exported symbol still has callers', () => {
    const r = evaluateEdit(deps());
    expect(r.fire).toBe(true);
    expect(r.reason).toBe('deleted_symbol_has_callers');
    expect(r.findings).toHaveLength(1);
  });

  it('⛔ does NOT fire when something was deleted but nothing calls it', () => {
    // The single most important negative. This is the ordinary case — deleting dead code — and if
    // it fired here the rule would be noise on every cleanup commit.
    const r = evaluateEdit(deps({ findFindings: () => [] }));
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('deleted_but_no_callers');
  });

  it('⛔ does NOT fire when nothing was deleted — the cheap pre-filter', () => {
    const r = evaluateEdit(deps({ removedDeclarations: () => [] }));
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('nothing_deleted');
  });

  it('⭐ the DB lookup is never reached when nothing was deleted', () => {
    // ⚠ ORDERING IS LOAD-BEARING, NOT TIDINESS. This runs after every edit an agent makes; opening
    // a graph database on the ~95% that cannot fire is a per-edit latency tax, and a correct
    // feature that makes editing feel slow is one an operator turns off.
    let dbTouched = 0;
    evaluateEdit(deps({
      removedDeclarations: () => [],
      findFindings: () => { dbTouched += 1; return []; },
    }));
    expect(dbTouched, 'the database must not be opened when the text pre-filter says no').toBe(0);
  });

  it('⛔ does NOT fire outside an APG repo — safe to install globally', () => {
    const r = evaluateEdit(deps({ isApgRepo: () => false }));
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('not_an_apg_repo');
  });

  it('⛔ does NOT fire for a non-edit tool', () => {
    const r = evaluateEdit(deps({ payload: { tool_name: 'Bash', tool_input: { command: 'ls' } } }));
    expect(r.fire).toBe(false);
    expect(r.reason).toBe('not_an_edit_tool');
  });

  it('⛔ every failure mode is SILENT, never noisy and never thrown', () => {
    // A hook that throws runs on every single edit. One that errors loudly is worse than one that
    // does not exist, because it teaches the operator to remove it — and takes every future signal
    // on this channel with it.
    const throwing = [
      { diffFor: () => { throw new Error('git exploded'); }, reason: 'diff_unavailable' },
      { removedDeclarations: () => { throw new Error('parse exploded'); }, reason: 'parse_failed' },
      { findFindings: () => { throw new Error('db exploded'); }, reason: 'lookup_failed' },
    ];
    for (const t of throwing) {
      const { reason, ...over } = t;
      let r;
      expect(() => { r = evaluateEdit(deps(over)); }, reason).not.toThrow();
      expect(r.fire, reason).toBe(false);
      expect(r.reason).toBe(reason);
    }
  });

  it('⛔ an empty or malformed payload is silent, not a crash', () => {
    for (const p of [undefined, null, {}, { tool_name: 'Edit' }, { tool_name: 'Edit', tool_input: {} }]) {
      let r;
      expect(() => { r = evaluateEdit(deps({ payload: p })); }, JSON.stringify(p)).not.toThrow();
      expect(r.fire).toBe(false);
    }
  });

  it('⭐ says NO far more often than YES across the decision space', () => {
    // The exit criterion for this whole feature was a measured FIRE RATE. A predicate that fires
    // easily is slop however clever, so counting both outcomes is the cheapest standing proof.
    const cases = [
      deps(),                                                     // fires
      deps({ findFindings: () => [] }),
      deps({ removedDeclarations: () => [] }),
      deps({ isApgRepo: () => false }),
      deps({ payload: { tool_name: 'Read', tool_input: { file_path: '/repo/a.js' } } }),
      deps({ diffFor: () => '' }),
      deps({ payload: {} }),
    ];
    const fired = cases.filter((c) => evaluateEdit(c).fire);
    expect(fired).toHaveLength(1);
    expect(fired.length).toBeLessThan(cases.length - fired.length);
  });
});

describe('payload parsing — defensive, because a shifted format must go quiet not loud', () => {
  it('reads the common single-file shapes', () => {
    expect(editedFilesFromPayload({ tool_input: { file_path: '/a.js' } })).toEqual(['/a.js']);
    expect(editedFilesFromPayload({ toolInput: { filePath: '/b.js' } })).toEqual(['/b.js']);
  });

  it('reads a MultiEdit-style list and de-duplicates it', () => {
    const files = editedFilesFromPayload({
      tool_input: { edits: [{ file_path: '/a.js' }, { file_path: '/a.js' }, { file_path: '/b.js' }] },
    });
    expect(files).toEqual(['/a.js', '/b.js']);
  });

  it('⛔ returns empty rather than throwing on anything unexpected', () => {
    for (const p of [undefined, null, {}, { tool_input: null }, { tool_input: { edits: 'nope' } }]) {
      expect(() => editedFilesFromPayload(p)).not.toThrow();
      expect(editedFilesFromPayload(p)).toEqual([]);
    }
  });

  it('isEditTool recognises the editing tools and rejects the rest', () => {
    for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) expect(isEditTool({ tool_name: t }), t).toBe(true);
    for (const t of ['Bash', 'Read', 'Grep', '', undefined]) expect(isEditTool({ tool_name: t }), String(t)).toBe(false);
  });
});

describe('renderFindings — one chance to be worth reading', () => {
  const finding = (n) => ({
    symbol: 'target',
    callers: Array.from({ length: n }, (_, i) => ({ file: `src/f${i}.js`, caller: `fn${i}` })),
  });

  it('leads with the contradiction, then the callers, then the remedy', () => {
    const out = renderFindings([finding(2)]);
    expect(out).toMatch(/^⛔ You deleted a symbol that still has callers\./);
    expect(out).toContain('src/f0.js');
    expect(out).toMatch(/restore the symbol, or update the callers/i);
  });

  it('⛔ CAPS the caller list and says how many were withheld', () => {
    // A rare signal that arrives as a wall of text is a rare signal that gets skipped.
    const out = renderFindings([finding(12)]);
    expect(out).toContain('… and 7 more');
    expect(out.split('\n').filter((l) => l.includes('src/f')).length).toBe(5);
  });

  it('names the evidence as compiler-verified, because that is what makes it worth obeying', () => {
    expect(renderFindings([finding(1)])).toMatch(/compiler-verified/i);
  });
});
