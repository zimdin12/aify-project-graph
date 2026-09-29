// ⛔⛔ EVERY SYMBOL THE HAND-RUN AUDITS NAME MUST STILL RESOLVE.
//
// dashboard-manager's mitigation, 2026-09-29, and it is the right size for a gap I could not price. The
// suite cannot run these audits — they build git fixtures, index them, and take minutes. But it can ask
// whether their PRECONDITIONS still hold: do the modules they load exist, and do the symbols they destructure
// off those modules still exist?
//
// ⇒ "It is strictly less than running it and strictly more than nothing, and the gap between those two is
// where both our weeks went." It converts "the next person runs the audit and reads a meaningless green"
// into "the suite went red three weeks ago".
//
// WHY THESE THREE FILES NEED IT MORE THAN MOST. Measured 2026-09-29:
//   audit-rename-handling.mjs               664 lines, ZERO tests of its internals, 19 commits citing arms
//   audit-ref-conservation-across-run.mjs   446 lines
//   audit-ref-conservation-broken-subject.mjs  237 lines
// None is among the 67 `scripts/` modules any test imports (of 161). NOTHING automated runs them — not
// `package.json`, not the hooks, not `run-suite`, not `gated-push`. So a product-side rename breaks them
// silently and the failure surfaces only when a human runs one and misreads the result.
//
// ⛔ THEY CANNOT SIMPLY BE IMPORTED TO INTROSPECT: each self-executes its whole audit on import. Hence a
// SOURCE SCAN of their `await load(...)` calls, which is weaker than structural ownership and says so — a
// change to the load idiom makes the parse find nothing. That is why the population count is asserted, not
// merely used: a parser that matched nothing would report "all preconditions hold" over zero symbols.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SCRIPTS = join(REPO, 'scripts');

// POPULATION DERIVED, NEVER LISTED: whichever scripts use the idiom are the ones covered. A hardcoded list
// of three filenames is a list somebody must remember to extend, which is a defect with a delay on it.
function auditsUsingLoad() {
  return readdirSync(SCRIPTS)
    .filter((f) => f.endsWith('.mjs'))
    .filter((f) => readFileSync(join(SCRIPTS, f), 'utf8').includes('await load('))
    .sort();
}

const LOAD_CALL = /const\s*\{([^}]+)\}\s*=\s*await\s+load\(([^)]*)\)/gu;

function declaredLoads(file) {
  const src = readFileSync(join(SCRIPTS, file), 'utf8');
  const out = [];
  for (const m of src.matchAll(LOAD_CALL)) {
    // ⛔ AN ALIASING DESTRUCTURE NAMES THE EXPORT ON THE LEFT OF THE COLON.
    // `const { ensureFresh: currentEnsureFresh } = await load(...)` imports `ensureFresh`; the alias is a
    // local name the module knows nothing about. This guard's FIRST RUN reported that line as a missing
    // symbol — a false positive from this parser, not a defect in the audit, caught because the run happened
    // immediately. Worth recording: a guard whose first fire is a false alarm teaches the reader to discount
    // the one report that would matter, which is worse than a missing alarm.
    const names = m[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.includes(':') ? s.split(':')[0].trim() : s));
    const segments = [...m[2].matchAll(/'([^']+)'/gu)].map((s) => s[1]);
    if (names.length && segments.length) out.push({ names, segments });
  }
  return out;
}

const AUDITS = auditsUsingLoad();

describe('the hand-run audits still resolve everything they name', () => {
  it('★★★ the parse found audits and load calls — otherwise every arm below is vacuous', () => {
    // ⛔ THE CONTROL THAT DECIDES THIS FILE. A regex that matched nothing and a tree where every
    // precondition holds produce the identical green.
    expect(AUDITS.length, 'at least the three known audits use the idiom').toBeGreaterThanOrEqual(3);
    const total = AUDITS.reduce((n, f) => n + declaredLoads(f).length, 0);
    expect(total, 'and they declare a real number of loads').toBeGreaterThanOrEqual(8);
  });

  it.each(AUDITS)('★★★ %s — every module it loads exists and exports every symbol it names', async (file) => {
    const loads = declaredLoads(file);
    expect(loads.length, `${file} must declare at least one load, or the parse is broken`).toBeGreaterThan(0);

    const missingModules = [];
    const missingSymbols = [];
    for (const { names, segments } of loads) {
      const abs = join(REPO, ...segments);
      if (!existsSync(abs)) {
        missingModules.push(segments.join('/'));
        continue;
      }
      const mod = await import(pathToFileURL(abs).href);
      for (const name of names) {
        if (!(name in mod)) missingSymbols.push(`${segments.join('/')} → ${name}`);
      }
    }

    expect(missingModules, `${file} loads a module that no longer exists`).toEqual([]);
    expect(missingSymbols, `${file} destructures a symbol its module no longer exports — `
      + 'the audit would throw on its first line, and nothing automated runs it to find out').toEqual([]);
  });

  it('★★★ NEGATIVE CONTROL — a fabricated symbol is reported missing', () => {
    // Proves the `name in mod` predicate can say NO. Without it, "no missing symbols" could be the verdict
    // of a check that accepts anything — and this repo has shipped that exact wrong-zero more than once.
    const mod = { realExport: () => {} };
    expect('realExport' in mod, 'positive: a present name is found').toBe(true);
    expect('zzq_not_exported' in mod, 'negative: an absent name is reported absent').toBe(false);
  });

  it('★★★ and the parser can FIND a load call, in every shape these files actually use', () => {
    // A control on the regex itself rather than on its result, covering all three spellings present in the
    // tree — including the ALIASING one whose omission made this guard's first run a false positive.
    const sample = "const { a, b } = await load('mcp', 'stdio', 'x.js');\n"
      + "const { c } = await load('scripts', 'lib', 'y.mjs');\n"
      + "const { ensureFresh: renamed } = await load('mcp', 'stdio', 'z.js');";
    const found = [...sample.matchAll(LOAD_CALL)];
    expect(found.length, 'three load calls in the sample').toBe(3);
    expect(found[0][1].split(',').map((s) => s.trim())).toEqual(['a', 'b']);
    // The alias must reduce to the EXPORTED name, which is what `name in mod` will be asked about.
    expect(found[2][1].trim().split(':')[0].trim(), 'the export, not the local alias').toBe('ensureFresh');
  });
});
