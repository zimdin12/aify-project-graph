// A POSITION WE CANNOT PLACE MUST NOT BE QUERIED FOR RELATIONS.
//
// When the identifier column cannot be located we fall back to column 0 of the
// declaration line — whatever token happens to sit there: a return type, a
// namespace, a macro. Asking clangd for definitions/references AT that position
// returns a TRUTHFUL answer about the WRONG SYMBOL, recorded under this symbol's
// id. For a common type that is tens of thousands of references.
//
// Field measurement (sc-manager, 2026-07-30) — two adjacent batches of the same
// repo, minutes apart, one server process:
//     files 1-60     3,083 refs   (~51/file)      55 guessed positions
//     files 61-106   1,618,718 refs (~35,190/file) 1,412 guessed positions
// A ~500x per-file discontinuity moving in lockstep with the guess count. He
// reported the DISCONTINUITY rather than judging 1.6M implausible for templated
// C++ — that framing is what made it diagnosable rather than arguable.
//
// Second guard: even a correctly-placed hub symbol can return tens of thousands of
// references, and the import is O(records) — 330,794 records took 6.3 minutes
// against a 100s budget. Capped, and the cap is REPORTED so a capped set reads as
// a floor rather than a complete answer.
import { describe, it, expect } from 'vitest';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../mcp/stdio/code-intel/providers/cpp-clangd.js'),
  'utf8',
);

describe('guessed positions are not queried for relations', () => {
  it('skips definitions/references when the identifier column was guessed', () => {
    expect(src).toMatch(/if \(posGuessed\) \{/);
    // The skip must come BEFORE either relation query, or it does nothing.
    // Match the per-symbol query blocks specifically — an earlier line gates the
    // whole loop on the same op names, and matching that instead would make this
    // assertion pass without checking anything.
    const skipPos = src.indexOf('if (posGuessed) {');
    const defsPos = src.indexOf("if (requestedOps.has('definitions')) {");
    const refsPos = src.indexOf("if (requestedOps.has('references')) {");
    expect(skipPos).toBeGreaterThan(-1);
    expect(skipPos).toBeLessThan(defsPos);
    expect(skipPos).toBeLessThan(refsPos);
    expect(src).toMatch(/continue;/);
  });

  it('still records the symbol, marked position_unresolved', () => {
    // documentSymbol told us the symbol exists — that much IS known. What we
    // decline is attributing relations we cannot place. Dropping the symbol
    // entirely would lose real information.
    expect(src).toMatch(/result_state: 'position_unresolved'/);
    expect(src).toMatch(/definitions\/references were NOT queried/);
  });

  it('counts what it declined, so the skip is visible not silent', () => {
    expect(src).toMatch(/positionGuessSkipped \+= 1/);
    expect(src).toMatch(/^\s+positionGuessSkipped,$/m);
  });

  it('caps references per symbol and REPORTS the truncation', () => {
    expect(src).toMatch(/const MAX_REFS_PER_SYMBOL = \d+/);
    expect(src).toMatch(/refs\.slice\(0, MAX_REFS_PER_SYMBOL\)/);
    // A silently-capped set read as "no other callers" is the exact
    // false-completeness failure this codebase exists to prevent.
    expect(src).toMatch(/truncated: droppedRefs, totalReferences: refs\.length/);
    expect(src).toMatch(/operations\.references\.status = 'partial'/);
    expect(src).toMatch(/refsTruncatedSymbols \+= 1/);
  });

  it('counts only KEPT references in the operation total', () => {
    // Counting all of them would report coverage the records do not contain.
    expect(src).toMatch(/operations\.references\.count \+= kept\.length/);
    // ⚠ CONTROLLED — this forbids counting references that were never queried, which is the
    // defect the whole file exists for. A silent pass here restores it.
    expectAbsentWithLiveMatcher(
      /operations\.references\.count \+= refs\.length/,
      {
        forbidden: 'operations.references.count += refs.length;',
        allowed: 'operations.references.count += queried.length;',
      },
      src,
      'a reference count must not include positions that were never asked',
    );
  });
});
