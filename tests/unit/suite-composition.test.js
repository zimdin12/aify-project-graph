// ★ "1688 TESTS PASS" IS NOT A STATEMENT ABOUT BEHAVIOUR, AND I KEPT QUOTING IT AS ONE.
//
// graph-senior-dev's scope-4 audit (2026-08-10) measured that 68 of 1,593 declared cases
// invoke ZERO production behaviour — they read implementation files and assert regexes,
// token order, comments. All 68 stay green if the named behaviour becomes unreachable
// while the source spelling survives. Two more pass with no assertion at all on live
// paths, and 23 report PASS where they should report SKIP.
//
// Their conclusion, which this file enforces: counting those in one green headline
// INFLATES BEHAVIOURAL CONFIDENCE. The fix is classification, not deletion — structural
// contracts are worth keeping, they just must not be laundered into behavioural cover.
//
// And I am the reason it needs enforcing rather than documenting. I quoted "1688 pass"
// in four commit messages on 2026-08-11, after reading the audit, while ADDING to the
// number. A count that flatters the person reporting it does not get audited by them.
//
// ⚠ WHAT THIS FILE IS NOT: a claim that source-contract tests are worthless. Several
// below guard things that have no runtime surface to assert against. The claim is
// narrower and harder to argue with — THEY CANNOT FAIL WHEN THE BEHAVIOUR BREAKS, so
// they belong in a different denominator.
//
// ⚠ AND THE CLASSIFIER IS A HEURISTIC, stated plainly rather than dressed up: it asks
// whether a file reads implementation TEXT without importing implementation CODE. That
// under-counts mixed files (which contain source-only cases alongside real ones) and
// cannot see a zero-assert case at all. So the numbers here are a FLOOR, exactly as the
// original audit said of its own 68.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const TESTS_ROOT = join(import.meta.dirname, '..');

function allTestFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allTestFiles(p, out);
    else if (name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

function classify(filePath) {
  const src = readFileSync(filePath, 'utf8');
  const readsImplText = /readFileSync\([^)]*(mcp|scripts|integrations)/.test(src)
    || /readFileSync\(\s*join\([^)]*(mcp|scripts)/.test(src);
  const importsImplCode = /from '[^']*\/(mcp|scripts)\//.test(src);
  if (readsImplText && !importsImplCode) return 'source_contract';
  if (readsImplText && importsImplCode) return 'mixed';
  return 'behavioural';
}

// ★ THE RATCHET. Every file here asserts on implementation TEXT and imports no
// implementation CODE, so none of them can fail when the behaviour they describe
// breaks. The list may SHRINK freely — converting one to a behavioural test is the
// goal. It may not GROW without a deliberate edit here, which is the whole point: a
// new one should cost a conversation, not slip in during a busy evening.
//
// Two were converted on 2026-08-11 and are deliberately absent:
//   · tier-identity-check's comment-matching case → tier-identity-behaviour.test.js,
//     which found a live `import_linked` mislabel within three minutes of running code
//   · framing-not-data's two declaration-shape assertions → the same file
const KNOWN_SOURCE_CONTRACT = new Set([
  'unit/code-intel/degraded-split-persistence.test.js',
  'unit/code-intel/skip-counters-survive-the-write.test.js',
  'unit/dashboard/repo-root-wiring.test.js',
  'unit/query/ambiguous-not-unmapped.test.js',
  'unit/query/candidate-truncation-disclosed.test.js',
  'unit/query/coverage-denominator.test.js',
  'unit/query/dirty-omitted-reconciles.test.js',
  'unit/query/health-dirty-noise.test.js',
  'unit/query/observed-doc-mentions.test.js',
  'unit/query/packet-cheap-symbol-lookup.test.js',
  'unit/query/packet-symbol-location.test.js',
  'unit/query/packet-timeout-not-absence.test.js',
  'unit/query/packet-unranked-candidates.test.js',
  'unit/query/recompile-surface-termination.test.js',
  'unit/query/response-budget.test.js',
  'unit/query/stale-warning-actionable.test.js',
  // 'unit/query/tier-identity-check.test.js' — DELETED 2026-08-11 with the
  // `symbol_referenced` tier it guarded. Its behavioural successor is
  // tier-identity-behaviour.test.js, which found a live mislabel within three minutes
  // of running the code the deleted file had only ever grepped.
  'unit/scripts/reindex-payload.test.js',
]);

describe('suite composition — what the green headline actually covers', () => {
  const files = allTestFiles(TESTS_ROOT);
  const byKind = { source_contract: [], mixed: [], behavioural: [] };
  for (const f of files) {
    byKind[classify(f)].push(relative(TESTS_ROOT, f).split(sep).join('/'));
  }

  it('★ no NEW source-contract-only test file appears without a deliberate edit here', () => {
    const unexpected = byKind.source_contract.filter((f) => !KNOWN_SOURCE_CONTRACT.has(f));
    expect(unexpected, [
      'A NEW TEST FILE ASSERTS ON IMPLEMENTATION TEXT AND RUNS NO IMPLEMENTATION CODE.',
      'It cannot fail when the behaviour it describes breaks, and it CAN fail when a line',
      'is reflowed — three did exactly that on 2026-08-11, each time on a fix rather than',
      'a regression. Prefer a fixture that runs the code. If the contract genuinely has no',
      'runtime surface, add the file to KNOWN_SOURCE_CONTRACT with a reason.',
    ].join(' ')).toEqual([]);
  });

  it('the ratchet only turns one way — a converted file must be removed from the list', () => {
    // Shrinking is the goal, so a stale entry is not a failure — but it must not be
    // invisible, or the list stops describing the suite and starts describing history.
    const stale = [...KNOWN_SOURCE_CONTRACT].filter((f) => !byKind.source_contract.includes(f));
    expect(stale, 'these are no longer source-contract-only — remove them from KNOWN_SOURCE_CONTRACT').toEqual([]);
  });

  it('★ reports the three denominators separately, so no one number stands for all of them', () => {
    // The assertion is deliberately weak; the VALUE is the printed breakdown. A single
    // "N pass" is the thing being corrected here, and a test that produced another
    // single number would be repeating the mistake in a smaller font.
    const total = files.length;
    const lines = [
      `  behavioural files : ${byKind.behavioural.length}`,
      `  mixed files       : ${byKind.mixed.length}  (contain source-only cases too — a FLOOR)`,
      `  source-contract   : ${byKind.source_contract.length}  (cannot fail when behaviour breaks)`,
      `  total             : ${total}`,
    ].join('\n');
    // eslint-disable-next-line no-console
    console.log(`\nSUITE COMPOSITION — quote these three, not one:\n${lines}\n`);

    expect(total).toBe(byKind.behavioural.length + byKind.mixed.length + byKind.source_contract.length);
    // A floor on health, not a target: if the behavioural share ever drops below half,
    // the headline has stopped meaning anything at all.
    expect(byKind.behavioural.length / total).toBeGreaterThan(0.5);
  });
});
