import { describe, it, expect } from 'vitest';
import { extractFile } from '../../../mcp/stdio/ingest/extractors/generic.js';
import { getLanguageConfig } from '../../../mcp/stdio/ingest/languages/index.js';

// ⛔⛔ A REAL, CURRENT DEFECT — AND I TWICE MISREAD THE EVIDENCE FOR IT.
//
// The live graph held 94 CALLS edges targeting an External named `new`. My first explanation was
// that the extractor read `new Foo()` as a call to `new`; a guard built on that was reverted the
// same day because it also refused `promise.catch(...)`, which is a real member call.
//
// ⛔ THEN I MEASURED A FRESH INDEX AND READ `new` = 0, and concluded the whole thing was historical
// residue. That was WRONG: those index arms were built at 8f61239, where the guard was still active
// and suppressing the exact two labels I was counting. A fresh index at 6d2d699, with the guard
// gone, reports `new` = 96. Twice now, a setup that could not exhibit the effect returned the same
// answer as a system that does not have it.
//
// ⭐ THE ACTUAL DEFECT, isolated by varying one thing — whether the constructor is CHAINED:
//
//     new Date();                 ->  Date                       correct
//     new Date().toISOString();   ->  new, Date                  `toISOString` LOST
//     new Foo().a().b();          ->  new, new, Foo              `a` and `b` LOST
//
// normalizeCallTarget took the FIRST whitespace token of `new Foo(1).bar`, which is the keyword.
// ⚠ The junk target was never the serious half. A stub shows up in any census; a MISSING call is
// invisible by construction, and graph_callers on the real method just answered with silence.
//
// Fixed by splitting on the member separator before the whitespace pass. This file pins both halves:
// the callee that must appear, and the keyword that must not.

const FILE = 'src/app.js';

const SOURCE = `export function run(p) {
  const stamp = new Date().toISOString();
  const re = new RegExp('^x$');
  const settled = p.catch(() => null);
  try {
    JSON.parse(stamp);
  } catch (e) {
    return null;
  }
  const registry = { new: () => 1, delete: () => 2 };
  registry.new();
  registry.delete();
  return settled;
}
`;

describe('constructor and catch callees — the producer contract', () => {
  const config = getLanguageConfig(FILE);
  const { refs } = extractFile({ filePath: FILE, source: SOURCE, config });
  const callTargets = refs.filter((r) => r.relation === 'CALLS').map((r) => r.target);

  it('⭐ CONTROL: the extractor produced calls at all', () => {
    // Without this, every absence assertion below passes on a dead extraction.
    expect(callTargets.length, 'no CALLS refs at all means the rest of this file proves nothing')
      .toBeGreaterThan(0);
  });

  it('⛔ `new Date()` emits the CONSTRUCTOR, not the keyword', () => {
    expect(callTargets).toContain('Date');
    expect(callTargets).toContain('RegExp');
  });

  it('⛔ a `catch (e)` clause emits no call — it is not one', () => {
    // The source above contains exactly one catch CLAUSE and one .catch() MEMBER CALL, so a `catch`
    // target here can only come from the member call. Counting is the discrimination.
    const catches = callTargets.filter((t) => t === 'catch');
    expect(catches, 'one .catch() member call, one catch clause, so exactly one target')
      .toHaveLength(1);
  });

  it('⛔ `promise.catch()` DOES emit `catch` — the case the reverted guard destroyed', () => {
    expect(callTargets).toContain('catch');
  });

  it('⛔ member methods named after keywords survive', () => {
    // `registry.new()` and `registry.delete()` are legal JavaScript and must reach the graph.
    expect(callTargets).toContain('new');
    expect(callTargets).toContain('delete');
  });

  it('⛔ the keyword `new` is never a target on its own account', () => {
    // The source has exactly ONE legitimate `new` — the member call registry.new(). The two
    // `new X()` constructions must contribute Date and RegExp and nothing else. A second `new` here
    // means constructor syntax has leaked back into the callee position.
    expect(callTargets.filter((t) => t === 'new'), 'only the member call may produce `new`')
      .toHaveLength(1);
  });

  it('⛔⛔ A CHAINED CONSTRUCTOR KEEPS ITS METHOD CALLEE — the edge that was being lost', () => {
    // `new Date().toISOString()` in the fixture. Before the fix this emitted `new` and dropped
    // `toISOString` entirely, so the method had no incoming edge at all.
    expect(callTargets, 'the method chained onto a constructor must survive').toContain('toISOString');
  });
});
