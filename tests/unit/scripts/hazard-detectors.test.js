// ⛔ THE INVENTORY IS AN INSTRUMENT, SO IT GETS THE SAME CONTROLS I DEMAND OF EVERYTHING ELSE.
//
// A detector that finds nothing and a detector that cannot find anything produce the same output.
// Every category below is exercised in BOTH directions: a shape it must catch, and a nearby shape
// it must NOT catch.
//
// ⛔⛔ AND THE CONTROL THAT ACTUALLY MATTERED: my first version MISSED THE DEFECT IT WAS BUILT FROM.
// The live-instance control passed (it found safeDirtyCount), so nothing would have revealed the
// hole. Only running it against the PRE-FIX source of refactor-guard exposed it: the original was
// `entry.volatileShapeOk = excluded.every(...)`, a plain ASSIGNMENT, and I had handled variable
// declarations and object-literal properties and forgotten assignment entirely. It returned ZERO
// while the defect sat there twice.
//
// ⇒ A tool for finding vacuous checks was itself vacuous. Test an instrument against the case that
// motivated it, not merely against a case it happens to catch.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(new URL('../../../package.json', import.meta.url)));
import {
  vacuousQuantifiers, failOpenCatches, emptyCatchKeepsDefault, selfReportingLiterals, NOT_IMPLEMENTED,
} from '../../../scripts/lib/hazard-detectors.mjs';

describe('vacuous quantifiers', () => {
  it('★★★⛔ THE ORIGINAL DEFECT, in its original form: assignment to a property', () => {
    // Byte-for-byte the shape from refactor-guard before the fix. Verified against the real
    // pre-fix source at cba2974^, which yielded exactly 2 hits at lines 213 and 238.
    const hits = vacuousQuantifiers('entry.volatileShapeOk = excluded.every((l) => VOLATILE_LINE.test(l));');
    expect(hits.length, 'the shape the tool exists for must be caught').toBe(1);
    expect(hits[0].quantifier).toBe('every');
    expect(hits[0].context).toMatch(/assigned to entry\.volatileShapeOk/);
    expect(hits[0].question).toMatch(/is EMPTY, this yields true/);
  });

  it('★★★ THE REPAIRED COUNTERPART: the fixed form is NOT flagged', () => {
    // ⛔ THE PAIR IS THE FIXTURE, not the defect alone. A detector holding only the broken form can
    // pass by flagging everything; a detector holding only the fixed form can pass by flagging
    // nothing. Frozen together, they pin the DISCRIMINATION rather than either half of it.
    //
    // This is the shape refactor-guard actually carries now: the quantifier moved behind a named
    // predicate that requires exact cardinality, so there is no bare quantifier left to be vacuous.
    expect(vacuousQuantifiers('entry.volatileShapeOk = volatileShapeOk(excluded);')).toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: every gate context is recognised', () => {
    // Enumerating the contexts I could think of is how the assignment case got missed, so each one
    // that IS handled is pinned. A context silently dropped later would otherwise read as "clean".
    const cases = {
      'return xs.every(p);': /returned/,
      'if (xs.every(p)) { go(); }': /if-condition/,
      'const ok = xs.every(p);': /assigned to `ok`/,
      'const o = { ok: xs.every(p) };': /assigned to property `ok`/,
      'obj.flag = xs.every(p);': /assigned to obj\.flag/,
      'const y = xs.every(p) && z;': /boolean operand/,
      'if (!xs.every(p)) fail();': /negated/,
      'const f = () => xs.every(p);': /arrow body/,
    };
    for (const [src, want] of Object.entries(cases)) {
      const h = vacuousQuantifiers(src);
      expect(h.length, src).toBe(1);
      expect(h[0].context, src).toMatch(want);
    }
  });

  it('★★★⛔ ONE PAREN USED TO DEFEAT EVERY RULE IN THE FUNCTION', () => {
    // ⛔⛔ NOT AN ENUMERATION GAP — A STRUCTURAL ONE. `node.parent` became a ParenthesizedExpression,
    // so return / assignment / arrow / if / ternary ALL stopped matching at once. Parenthesising is
    // not a different context; it is the SAME context wearing a transparent wrapper, semantically
    // identical, and formatters add and remove them freely.
    //
    // ⇒ Every context added later would have inherited the hole. So the wrapper is stripped BEFORE
    // classification, and this test is what stops it coming back.
    //
    // ⚠ AND IT CHANGED WHAT THE OTHER CONTROLS PROVED: they all use unparenthesized source, so they
    // could not distinguish "handles assignment" from "handles assignment as long as nobody wrapped
    // it". They were passing on a strictly easier corpus than reality.
    // Found in field testing, running 24 constructs as a corpus rather than imagining cases.
    for (const src of ['return (xs.every(p));', 'e.ok = (xs.every(p));', 'const f = () => (xs.every(p));']) {
      expect(vacuousQuantifiers(src).length, src).toBe(1);
    }
    // await and the comma operator's RIGHT operand are transparent the same way.
    expect(vacuousQuantifiers('async function f(){ return await (xs.every(p)); }').length).toBe(1);
  });

  it('★★★⛔ `&&=` `||=` `??=` ARE ASSIGNMENTS — the motivating defect, one token class over', () => {
    // ⛔ The `=` branch tested EqualsToken specifically, so a logical assignment to a gate variable
    // slipped past for exactly the reason plain assignment did before this tool existed.
    for (const op of ['&&=', '||=', '??=']) {
      expect(vacuousQuantifiers(`ok ${op} xs.every(p);`).length, op).toBe(1);
    }
  });

  it('★★★⛔ a quantifier inside an ASSERTION is a gate — where a vacuous true costs most', () => {
    // ⚠ KNOWINGLY AN ENUMERATION, over a much smaller and slower-moving set than syntax. Argument
    // position genuinely depends on the callee: console.log(...) is data, assert(...) is a verdict.
    // A blanket rule would be wrong — but omitting arguments entirely makes a vacuous quantifier
    // invisible exactly where it does the most damage: a test PASSING over an empty population.
    for (const src of ['assert(xs.every(p));', 'expect(xs.every(p)).toBe(true);', 'invariant(xs.every(p));']) {
      expect(vacuousQuantifiers(src).length, src).toBe(1);
    }
  });

  it('★★★ loop and class-field gates are recognised', () => {
    for (const src of ['while (xs.every(p)) {}', 'do {} while (xs.every(p));', 'class C { ok = xs.every(p); }']) {
      expect(vacuousQuantifiers(src).length, src).toBe(1);
    }
  });

  it('★★★ NEGATIVE CONTROL: a quantifier used as DATA is not a gate', () => {
    // ⛔ Without this the detector is satisfied by one that flags every `.every()` in the repo,
    // which would be 100% recall and no signal — the muted-detector failure.
    expect(vacuousQuantifiers('console.log(xs.every(p));')).toEqual([]);
    expect(vacuousQuantifiers('send(xs.every(p));')).toEqual([]);
  });

  it('★★★ .some() is reported too, but its empty case yields FALSE — the other direction', () => {
    // ⚠ `[].every()` is TRUE, so it fails OPEN — the dangerous direction. `[].some()` is FALSE and
    // usually fails closed. Both are answers nobody computed, so both are reported; the question
    // text is what distinguishes them for the reader.
    const some = vacuousQuantifiers('const any = xs.some(p);');
    expect(some[0].quantifier).toBe('some');
    expect(some[0].question).toMatch(/is EMPTY, this yields false/);
  });

  it('★★★⛔ an unparsable source THROWS rather than reporting a reassuring zero', () => {
    expect(() => vacuousQuantifiers('function ( {{{ broken')).toThrow(/did not parse cleanly/);
  });
});

describe('fail-open catches', () => {
  it('★★★⛔ THE LIVE INSTANCE: safeDirtyCount returns 0 when the git query fails', () => {
    // Found in the real corpus at mcp/stdio/query/verbs/packet-input.js:143. A failed git query
    // reports ZERO DIRTY FILES, indistinguishable from a clean tree, while the same output line
    // already uses `?` for an unknown commit.
    const hits = failOpenCatches('function f() { try { return g().length; } catch { return 0; } }');
    expect(hits.length).toBe(1);
    expect(hits[0].returns).toBe('0');
    expect(hits[0].question).toMatch(/Can a caller tell that apart from a genuine 0/);
  });

  it('★★★ THE REPAIRED COUNTERPART, now real: safeDirtyCount returns null for unknown', () => {
    // ⚠ THIS TEST USED TO SAY THE PAIR WAS INCOMPLETE, and it was right at the time: the motivating
    // defect was still live, so there was no repaired form to freeze beside it. Inventing a
    // plausible one would have made the pair look complete when half of it was imaginary — the
    // false-completeness this inventory exists to prevent, and worse inside an instrument.
    //
    // ⇒ safeDirtyCount has landed. This is its ACTUAL repaired shape, so the pair is now genuine
    // rather than promised: the broken form is flagged, the shipped form is not.
    expect(failOpenCatches('function f(r) { try { return g(r).length; } catch { return null; } }'),
      'null is a typed unknown, not a success-shaped literal').toEqual([]);
    expect(failOpenCatches("function f(){ try { return g(); } catch { return '?'; } }"),
      'and so is the ? marker this repo already uses for an unknown commit').toEqual([]);
    expect(failOpenCatches('function f(r) { try { return g(r).length; } catch { return 0; } }').length,
      'while the ORIGINAL broken form is still caught — the other half of the pair').toBe(1);
  });

  it('★★★ POSITIVE CONTROL: every success-shaped literal is caught', () => {
    for (const [ret, want] of [['0', '0'], ['true', 'true'], ['[]', '[]'], ['{}', '{}'], ["''", "''"]]) {
      const h = failOpenCatches(`function f(){ try { g(); } catch { return ${ret}; } }`);
      expect(h.length, ret).toBe(1);
      expect(h[0].returns, ret).toBe(want);
    }
  });

  it('★★★ NEGATIVE CONTROL: an HONEST catch is not flagged', () => {
    // ⛔ These are the correct patterns. Flagging them would train the reader to ignore the tool.
    expect(failOpenCatches('function f(){ try { g(); } catch { return null; } }'),
      'null is an explicit unknown, not a success').toEqual([]);
    expect(failOpenCatches("function f(){ try { g(); } catch { return '?'; } }"),
      "'?' is the honest marker this repo already uses").toEqual([]);
    expect(failOpenCatches('function f(){ try { g(); } catch (e) { throw e; } }'),
      'rethrowing is not failing open').toEqual([]);
    expect(failOpenCatches('function f(){ try { g(); } catch { log(); return 0; } }'),
      'a catch that does something else first needs a human, not this rule').toEqual([]);
  });
});

// ⛔⛔ THE DETECTOR COULD NOT MATCH THE DEFECT THE CLASS IS NAMED AFTER.
//
// `failOpenCatches` requires a catch body of EXACTLY ONE RETURN STATEMENT. The roadmap's PATTERN A
// names `FINDING-contract-failed-open` first, and its shape is an EMPTY catch:
//
//     let line = '';
//     try { line = '\n' + await buildAbsenceTrustLine({ ... }); }
//     catch { /* defensive */ }
//
// Zero statements, so `stmts.length === 1` is false and it can never match. An agent received a bare
// `NO CALLERS` with no TRUST, no SCOPE, no NOT MODELLED — byte-identical to a build without the
// feature — and the scanner built to find fail-open code reported nothing.
//
// Audited rather than assumed, with `git show <fix>^:<file>` against the real pre-fix sources:
//
//     pre-fix  callers.js @ 7cd2e74f^   failOpenCatches 0 hits   <- MISSED
//     pre-fix  callees.js @ 8e0eb4e2^   failOpenCatches 0 hits   <- MISSED
//
// ⚠ MEASURED BEFORE BUILDING, because a shape that matches everything is not a detector and this
// repo has shipped one with a 100% positive rate: 607 try/catch statements in mcp+scripts, 193 with
// an empty body, and 71 of those over an assignment to a variable declared OUTSIDE the try — 11.7%
// of all catches. The discriminator is the outer assignment, not the emptiness.
describe('empty catches that silently keep an optimistic default', () => {
  it('★★★⛔ THE MOTIVATING DEFECT, in its original form', () => {
    const hits = emptyCatchKeepsDefault(
      "async function f(){ let line = ''; try { line = await build(); } catch { /* defensive */ } return line; }");
    expect(hits.length, 'the shape the whole fail-open class is named after').toBe(1);
    expect(hits[0].keeps, 'and it names the variable left at its optimistic value').toEqual(['line']);
    expect(hits[0].question).toMatch(/left at the value it held before/);
  });

  it('★★★ THE REPAIRED COUNTERPART: assigning a disclosure in the catch is NOT flagged', () => {
    // This is the actual shipped fix — the catch now emits ABSENCE_TRUST_UNAVAILABLE rather than
    // leaving the empty string standing. A detector that still flagged it would be untrue to the
    // remedy and would train a reader to ignore it.
    expect(emptyCatchKeepsDefault(
      "async function f(){ let line = ''; try { line = await build(); } catch { line = UNAVAILABLE; } return line; }"),
    'a catch that discloses is not failing open').toEqual([]);
  });

  it('★★★ NEGATIVE CONTROL: an empty catch with nothing to keep is not flagged', () => {
    // ⛔ Emptiness alone is NOT the defect, and flagging it would raise the rate from 11.7% of
    // catches to 31.8% with nothing gained. What makes it fail open is a value assigned in the try
    // and READ afterwards, whose pre-try value is a plausible success.
    expect(emptyCatchKeepsDefault('function f(){ try { doCleanup(); } catch {} }'),
      'a best-effort side effect keeps no value').toEqual([]);
    // ⛔ THIS CONTROL WAS VACUOUS AND A MUTANT PROVED IT. It used to read
    // `try { const x = g(); use(x); }`, which has no ASSIGNMENT expression at all — `const x = g()`
    // is a declaration — so `assigned` was empty and the outer-name filter never ran. Deleting the
    // filter (`assigned.filter(a => !declaredInTry.has(a))` -> `assigned`) left all 21 tests green.
    //
    // ⇒ The discriminating case needs BOTH: declared inside the try AND assigned with `=` inside it.
    // Without the filter this flags `x`; with it, nothing.
    expect(emptyCatchKeepsDefault('function f(){ try { let x; x = g(); use(x); } catch {} }'),
      'a variable DECLARED inside the try does not survive it, so it carries no default outward')
      .toEqual([]);
    expect(emptyCatchKeepsDefault('function f(){ let x = 0; try { x = g(); } catch {} return x; }').length,
      'while the same shape over an OUTER declaration is still flagged — the other half of the pair')
      .toBe(1);
    expect(emptyCatchKeepsDefault('function f(){ let x = 1; try { g(); } catch {} return x; }'),
      'no assignment in the try means the catch changed nothing').toEqual([]);
  });

  it('★★★ POSITIVE CONTROL: several outer names are all reported, not just the first', () => {
    // Real instance: brief/generator.js:76 leaves TWO names standing.
    const hits = emptyCatchKeepsDefault(
      'function f(){ let a = 0; let b = []; try { a = g(); b = h(); } catch {} return [a, b]; }');
    expect(hits.length).toBe(1);
    expect(hits[0].keeps, 'both, or a reader chases the wrong variable').toEqual(['a', 'b']);
  });

  it('★★★⛔ an unparsable source THROWS rather than reporting a reassuring zero', () => {
    // The same rule every detector here holds: a file that will not parse is an UNKNOWN, not a
    // clean one, and a silent skip is how a scan reports a zero over files it never read.
    expect(() => emptyCatchKeepsDefault('function ( {')).toThrow();
  });
});

// ⛔ "5 OF 71 ADJUDICATED" IS NOT A CLAIM ANYONE CAN ACT ON.
//
// The sweep found 71 empty-catch candidates and I adjudicated five, chosen by reading. An outside
// reviewer named the error: I was ranking by the catch's SHAPE, when what matters is what its
// fallback GRANTS.
//
//   "Does the value this catch leaves standing reach a trust-bearing output — a banner, a gate,
//    exhaustive / stale / coverage / absenceAuthority, or any refusal-or-delete decision?"
//
// That partitions the 71 into a class where a fail-open is a SAFETY defect and a class where it is
// cosmetic. A catch whose optimistic default only affects a log line is not in the class however
// identical it looks to the detector. It also gives a stopping rule that terminates on a CONDITION
// rather than on fatigue — adjudicate every trust-bearing candidate, stop when that set is empty —
// and it re-runs unchanged as the code grows, which is the actual difference between a sweep and a
// one-off fix.
//
// ⚠ AND THE APPROXIMATION IS NAMED, NOT HIDDEN. Deciding that a VALUE reaches a trust-bearing
// output needs data-flow analysis, which this module already refuses to fake — see NOT_IMPLEMENTED.
// So the flag answers a WEAKER question that syntax can answer honestly: does the ENCLOSING
// FUNCTION emit a trust-bearing output at all? That OVER-includes, which is the safe direction for
// a triage filter, and the field is named for the question it actually answers.
describe('candidates are partitioned by what their fallback could reach', () => {
  const inTrustFn = `
    async function buildTrustLine(edges, db) {
      let stale = false;
      try { stale = await probe(db); } catch { }
      if (stale) return 'TRUST: lsp-partial — the set is a FLOOR, not exhaustive';
      return 'TRUST: lsp-verified';
    }`;
  const inLogFn = `
    function writeHookLog(path) {
      let count = 0;
      try { count = readEntries(path).length; } catch { }
      appendFileSync(path, 'entries: ' + count);
    }`;

  it('★★★ a catch inside a function that emits a trust claim is marked trust-bearing', () => {
    const hits = emptyCatchKeepsDefault(inTrustFn);
    expect(hits.length, 'fixture precondition: the shape must be detected at all').toBe(1);
    expect(hits[0].enclosingEmitsTrustClaim, 'this fallback can reach a banner').toBe(true);
    expect(hits[0].trustTokens, 'and it names WHY, so the reader can check the call rather than trust it')
      .toEqual(expect.arrayContaining(['TRUST:', 'exhaustive']));
  });

  it('★★★ NEGATIVE CONTROL: a catch in a function that only logs is NOT trust-bearing', () => {
    // ⛔ Without this the flag is decoration: a partition that puts everything on one side does not
    // partition anything, and this repo has shipped a "detector" with a 100% positive rate before.
    const hits = emptyCatchKeepsDefault(inLogFn);
    expect(hits.length, 'fixture precondition: still the same shape').toBe(1);
    expect(hits[0].enclosingEmitsTrustClaim, 'a log line is not a trust surface').toBe(false);
    expect(hits[0].trustTokens).toEqual([]);
  });

  it('★★★ the flag answers the FUNCTION-level question, and the name says so', () => {
    // ⚠ PINNING THE KNOWN OVER-INCLUSION rather than pretending precision. A trust token ANYWHERE in
    // the enclosing function marks the candidate, even when the kept value plainly cannot reach it.
    // That is the documented limit of a syntactic filter; the field is called
    // `enclosingEmitsTrustClaim` and not `fallbackReachesTrustClaim` for exactly this reason.
    const overIncluded = `
      function mixed(db) {
        let unrelated = 0;
        try { unrelated = countRows(db); } catch { }
        log(unrelated);
        return 'TRUST: lsp-verified';
      }`;
    const hits = emptyCatchKeepsDefault(overIncluded);
    expect(hits.length).toBe(1);
    expect(hits[0].enclosingEmitsTrustClaim,
      'over-inclusive by design — the safe direction for a triage filter').toBe(true);
  });

  it('★★ a catch at top level, with no enclosing function, does not crash and is not trust-bearing', () => {
    // A file-scope try/catch has no enclosing function to inspect. It must return a usable answer
    // rather than throwing — an instrument that dies on an ordinary shape reports a false zero for
    // every file that contains one.
    const hits = emptyCatchKeepsDefault("let x = 0;\ntry { x = load(); } catch { }\nuse(x);");
    expect(hits.length).toBe(1);
    expect(hits[0].enclosingEmitsTrustClaim).toBe(false);
  });
});

// ⭐ WHERE THE THROWS ACTUALLY ARE — a ranking derived from adjudications, not assumed.
//
// After adjudicating fifteen trust-bearing candidates, the split was clean: every one that came back
// REACHABLE had a try crossing a PROCESS BOUNDARY (`git rev-parse` via getHeadCommit, an LSP request
// via session.client), and every LATENT one was calling one of our own helpers, which already fail
// closed internally — `loadManifest` returns a manifest for a malformed file AND for a directory,
// `readSymbolBody` returns `''`, `parseDb` swallows to `null`, `computeCompileDbCoverage` returned on
// all twelve hostile inputs.
//
// ⚠ AND ITS AGREEMENT WITH THOSE FIFTEEN IS NOT EVIDENCE — it was derived from them. The claim it
// makes is about the ones NOT yet adjudicated, and that claim is falsifiable: if a candidate this
// ranks in-process turns out reachable, the heuristic is wrong and should be said so.
//
// ⛔ IT ORDERS, IT DOES NOT GRADE. A boundary-crossing candidate can still be harmless
// (`code_intel_live.js:842` is reachable and errs toward overcounting, which is safe), and the grant
// axis stays separate.
describe('candidates are ranked by whether the try leaves the process', () => {
  it('★★★ a try that shells out is marked, and the boundary is NAMED', () => {
    const hits = emptyCatchKeepsDefault(
      "function f(r){ let head = null; try { head = execFileSync('git', ['rev-parse','HEAD']); } catch { } return 'TRUST: ' + head; }");
    expect(hits.length).toBe(1);
    expect(hits[0].crossesProcessBoundary).toBe(true);
    expect(hits[0].boundaries, 'naming it lets a reader reason about THAT boundary')
      .toContain('child process');
  });

  it('★★★ NEGATIVE CONTROL: a try calling our own helpers is not marked', () => {
    // ⛔ Without this the flag is decoration. The whole value is the SPLIT; a rule that marks
    // everything orders nothing.
    const hits = emptyCatchKeepsDefault(
      "function f(db){ let c = null; try { c = summarise(db); } catch { } return 'TRUST: ' + c; }");
    expect(hits.length).toBe(1);
    expect(hits[0].crossesProcessBoundary).toBe(false);
    expect(hits[0].boundaries).toEqual([]);
  });

  it('★★★⛔ a boundary call inside its OWN try/catch does NOT count', () => {
    // Found by checking the instrument against a case rather than trusting its output:
    // orchestrator.js:815 was flagged "child process" for an `execFileSync` sitting inside
    // `try { ... } catch { changed = null; }` three lines deep. That call can never reach the OUTER
    // catch, so attributing it there over-ranks the candidate — and over-ranking is how a triage
    // order stops being worth following.
    const hits = emptyCatchKeepsDefault(`
      function f(r){
        let out = null;
        try {
          let changed = null;
          try { changed = execFileSync('git', ['diff']); } catch { changed = null; }
          out = summarise(changed);
        } catch { }
        return 'TRUST: ' + out;
      }`);
    expect(hits.length).toBe(1);
    expect(hits[0].crossesProcessBoundary,
      'the guarded call belongs to the inner catch, not this one').toBe(false);
  });

  it('★★★⛔ the word-boundary anchor holds: `respawn(` is not `spawn(`', () => {
    // ⛔ THIS EXISTS BECAUSE THE ANCHOR WAS SILENTLY DESTROYED AND EVERY TEST STILL PASSED.
    // A shell heredoc turned `\b` into a literal BACKSPACE byte (0x08) inside the regex, so the
    // pattern read `/execFileSync|execSync|<BS>spawn\(|…/`. `sed` renders 0x08 as nothing, so the
    // source LOOKED correct; the suite stayed green because a DIFFERENT alternative in the same
    // regex matched the fixture. A test passing on the wrong alternative is exactly the silent kill
    // this file has started guarding against elsewhere.
    const respawn = emptyCatchKeepsDefault(
      "function f(){ let x = null; try { x = respawn(3); } catch { } return 'TRUST: ' + x; }");
    expect(respawn.length).toBe(1);
    expect(respawn[0].boundaries, '`respawn(` is not a child-process spawn').toEqual([]);

    const real = emptyCatchKeepsDefault(
      "function f(){ let x = null; try { x = spawn('git'); } catch { } return 'TRUST: ' + x; }");
    expect(real[0].boundaries, 'and the anchored form still matches').toContain('child process');
  });

  it('★★★⛔ the detector source carries no control bytes', () => {
    // The general form of the defect above. A heredoc, a paste, or an editor can inject a raw
    // control character that every renderer hides and every regex silently mis-compiles. Checking
    // the BYTES is the only instrument that held — `sed`, the terminal and a passing suite all
    // reported the file as fine while it contained 0x08.
    const src = readFileSync(join(ROOT, 'scripts/lib/hazard-detectors.mjs'), 'utf8');
    const control = [...src].filter((ch) => {
      const c = ch.codePointAt(0);
      return c < 0x20 && ch !== '\n' && ch !== '\r' && ch !== '\t';
    });
    expect(control.map((c) => '0x' + c.codePointAt(0).toString(16)),
      'a control byte in source is invisible in every renderer and changes what the regex means')
      .toEqual([]);
    // ⚠ POSITIVE CONTROL on the reader: prove the file was actually read and is non-trivial, or an
    // empty read would satisfy the assertion above for the wrong reason.
    expect(src.length, 'the file was actually read').toBeGreaterThan(1000);
  });

  it('★★ POSITIVE CONTROL: the stripping does not blind the rule to an UNGUARDED sibling', () => {
    // The other half of the pair. If nested-stripping removed too much, a real boundary call sitting
    // beside a guarded one would vanish and the rule would under-rank instead of over-rank.
    const hits = emptyCatchKeepsDefault(`
      function f(r){
        let out = null;
        try {
          let changed = null;
          try { changed = execFileSync('git', ['diff']); } catch { changed = null; }
          out = readFileSync(r, 'utf8');
        } catch { }
        return 'TRUST: ' + out;
      }`);
    expect(hits.length).toBe(1);
    expect(hits[0].crossesProcessBoundary, 'the unguarded readFileSync still counts').toBe(true);
    expect(hits[0].boundaries).toContain('filesystem read');
  });
});

describe('the inventory is honest about what it does not do', () => {
  it('★★★ the unimplemented categories are NAMED, with reasons', () => {
    // ⚠ A tool silent about its blind spots reads as coverage. Two of the six requested categories
    // are not implemented and both say why in the artifact itself.
    expect(NOT_IMPLEMENTED.length).toBe(2);
    for (const n of NOT_IMPLEMENTED) {
      expect(n.category.length).toBeGreaterThan(10);
      expect(n.why.length, `${n.category} must carry a real reason`).toBeGreaterThan(80);
    }
  });

  it('★★★ the disabled category still WORKS — it is suppressed on noise, not broken', () => {
    // ⛔ The distinction matters. "Disabled because it is too noisy here" is a measurement;
    // "disabled because it never worked" would be a different claim entirely. It finds the real
    // instance that motivated the category.
    const hits = selfReportingLiterals('const r = { allowed: true, stillBlocksNewRuns: true };');
    expect(hits.map((h) => h.key)).toContain('stillBlocksNewRuns');
    expect(hits[0].question).toMatch(/Does anything DECIDE on it/);
  });
});
