// AN INTERNAL METADATA KEY RENDERED AS AN OPERATION WITH NO STATUS.
//
// ⛔ the field test reported `_session=undefined` in the EVIDENCE banner on every echoes packet,
// in both modes, and RE-RAISED IT after it survived two rounds of fixes — asking the right
// question: deliberately deferred, or lost?
//
// ⇒ LOST. `renderEvidenceLine` does `Object.entries(input.operations)` and prints
// `${op}=${info.status}`. `_session` is internal metadata written by the importer
// (importer.js:968) and read back by query.js:36 as a compatibility fallback for graphs that
// predate the dedicated columns. It is not an operation, it has no `status`, so it renders the
// literal string "undefined" — inside the line an agent reads to decide how much to trust
// everything else in the answer.
//
// ★ The re-raise is the finding as much as the defect is. A minor item that survives two
// rounds is a signal about how minor findings travel out of a report, not just about the item.
//
// ⇒ Filtered by SHAPE (leading underscore = internal), not by name. A name list would need
// editing the next time the importer adds a key, which is the enumeration failure this
// codebase keeps reproducing.
import { describe, it, expect } from 'vitest';
import { renderEvidenceLine } from '../../../mcp/stdio/code-intel/render.js';

const base = {
  provider: 'cpp-clangd',
  providerVersion: '0.1.0',
  status: 'ok',
  operations: {
    definitions: { status: 'ok', count: 1599 },
    references: { status: 'ok', count: 3164 },
    hover: { status: 'not_collected' },
    _session: { indexReady: true, mode: 'complete' },
  },
};

describe('EVIDENCE line operations summary', () => {
  it('★★★ does not render an internal key as an operation', () => {
    const line = renderEvidenceLine(base);
    expect(line, 'an internal metadata key is not an operation and has no status')
      .not.toMatch(/_session/);
  });

  it('★★★ never emits the literal string "undefined" as a status', () => {
    // The general form of the defect: any key without a `status` renders "undefined" into the
    // line a reader uses to calibrate trust. Assert the SYMPTOM, so a future key that is not
    // underscore-prefixed still cannot produce it silently.
    const line = renderEvidenceLine(base);
    expect(line, 'a status of "undefined" tells the reader nothing and looks like a bug')
      .not.toMatch(/=undefined/);
  });

  it('★★★ still reports every real operation, with counts', () => {
    // The control: filtering must not eat the payload it was added to protect.
    const line = renderEvidenceLine(base);
    expect(line).toMatch(/definitions=ok\(1599\)/);
    expect(line).toMatch(/references=ok\(3164\)/);
    expect(line).toMatch(/hover=not_collected/);
  });
});
