#!/usr/bin/env node
// DOES THE HAZARD SCANNER CATCH THE DEFECTS IT EXISTS FOR?
//
// ⛔ THE MOTIVATING CASE IS THE ONE A DETECTOR MOST OFTEN MISSES, and this project has the incident:
// `memory/instrument-vs-motivating-case` records a hazard scanner that did not flag the defect it was
// BUILT FROM. `hazard-inventory.mjs` reports 36 fail-open-catch candidates on today's tree, and a
// candidate count says nothing about RECALL — a detector that finds 36 shapes it happens to match is
// indistinguishable, from its own output, from one that misses the whole class.
//
// ⇒ So the population is not today's code. It is the code AS IT WAS when each known fail-open defect
// was live, recovered with `git show <fix>^:<file>` — the free positive control this repo already
// records. A detector is only credible on new defects if it fires on the old ones.
//
// PREREGISTERED, before any result existed:
//
//   POPULATION     the fail-open findings named in ROADMAP PATTERN A that have an identifiable code
//                  fix commit. Findings whose fix is evidence-only are EXCLUDED and listed as such,
//                  because there is no pre-fix source to test and counting them either way is a
//                  claim about a population I did not measure.
//   METHOD         for each, run the SAME detector the inventory runs, from the same module, over
//                  the pre-fix file. No re-implementation: a detector rewritten for the audit tests
//                  the rewrite.
//   FINDING SHAPE  { finding, fix, file, prefixFlags, postfixFlags, caught }
//   CAUGHT         the pre-fix file is flagged AND the count DROPS after the fix. A detector that
//                  flags both equally is matching something the fix did not change, which is not
//                  detection of this defect.
//   CONTROLS, same pass
//     POSITIVE — at least one pre-fix file must flag, or the detector is not running at all and
//                every "missed" verdict below is a fact about the harness, not about the detector.
//     NEGATIVE — a file with NO known fail-open defect must flag fewer times than the worst
//                pre-fix file, or the detector flags everything and its hits carry no information.
//   ABANDON RULE — if the detector catches ZERO of the population, do not tune it here. That is a
//                finding about the instrument and it goes in a document, not into a quiet patch that
//                makes the audit pass. Tuning a detector until it matches the answer you already
//                believe is how a screen selects its own result.
//
//   ⛔ CLAIM CEILING — this measures RECALL ON A KNOWN, FIXED, TINY POPULATION. It cannot say the
//   detector finds unknown defects, and a perfect score here would not mean the class is closed.
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { failOpenCatches, emptyCatchKeepsDefault } from './lib/hazard-detectors.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const say = (...a) => console.log(...a);

/** The pre-fix source of a file, from the commit BEFORE the fix landed. */
function sourceAt(rev, file) {
  try {
    return execFileSync('git', ['-C', REPO, 'show', `${rev}:${file}`], {
      encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
  } catch { return null; }
}

// ⚠ BOTH RULES, SUMMED, because the class is what is being audited and not one function. Splitting
// them would let a rule that catches nothing hide behind a sibling that does.
// ⛔ AND THE CATCH RETURNS null, NOT 0 — an unparsable or missing revision is UNKNOWN, and a zero
// here would read as "the detector found nothing", which is the exact fail-open shape this audit is
// about. The caller renders null as UNREADABLE and never as a miss.
function flagCount(src, file) {
  if (src === null) return null;
  try { return failOpenCatches(src, file).length + emptyCatchKeepsDefault(src, file).length; }
  catch { return null; }
}

// ⚠ Each row names the FIX COMMIT, not the finding document's commit. Two of PATTERN A's five
// findings were written up in evidence-only commits; the code change is a different sha, and testing
// the wrong one would report a clean pre-fix file and read as a miss by the detector.
const POPULATION = [
  {
    finding: 'FINDING-contract-failed-open',
    fix: '7cd2e74f',
    files: ['mcp/stdio/query/verbs/callers.js', 'mcp/stdio/query/verbs/impact.js'],
  },
  {
    finding: 'FINDING-results-banner-failed-open',
    fix: '8e0eb4e2',
    files: ['mcp/stdio/query/verbs/callers.js', 'mcp/stdio/query/verbs/callees.js'],
  },
  {
    finding: 'gitignore-negation (dirty=0 on a dirty tree)',
    fix: '1e1a07d0',
    files: ['mcp/stdio/freshness/git.js'],
  },
];

// Named, not silently dropped: a population that quietly excludes its hard cases reports a better
// score than it earned.
const EXCLUDED = [
  ['FINDING-tiers-fail-in-opposite-directions',
   'the defect was a WRONG CLAIM in prose about which tier sees what, not a fail-open code path — no catch, no default, nothing for this detector to match'],
  ['FINDING-the-answer-path-cannot-refuse',
   'the defect is an ABSENT branch — graph_callers never reads absenceAuthority. No syntax marks code that was never written, and this detector matches shapes that ARE present'],
];

say('AUDIT — does the fail-open detector fire on the defects it exists for?');
say('');

const rows = [];
for (const item of POPULATION) {
  for (const file of item.files) {
    const pre = flagCount(sourceAt(`${item.fix}^`, file), file);
    const post = flagCount(sourceAt(item.fix, file), file);
    rows.push({ ...item, file, pre, post, caught: pre !== null && post !== null && pre > 0 && post < pre });
  }
}

for (const r of rows) {
  const verdict = r.pre === null || r.post === null ? 'UNREADABLE'
    : r.caught ? 'CAUGHT' : (r.pre > 0 ? 'FLAGGED BUT UNCHANGED BY THE FIX' : 'MISSED');
  say(`  ${verdict.padEnd(32)} ${r.finding}`);
  say(`      ${r.file}  pre=${r.pre} post=${r.post}  (fix ${r.fix})`);
}

say('');
say('EXCLUDED FROM THE POPULATION, with the reason:');
for (const [name, why] of EXCLUDED) say(`  · ${name}\n      ${why}`);

// ---- CONTROLS, in this same pass ----
say('');
const anyPre = rows.some((r) => (r.pre ?? 0) > 0);
say(`[${anyPre ? 'PASS' : 'FAIL'}] POSITIVE CONTROL: the detector fires on at least one pre-fix file`);
if (!anyPre) {
  say('  ⛔ Every verdict above is a fact about this harness, not about the detector. Stop here.');
  process.exit(2);
}

// A file that has never carried one of these defects, read at the same revision as the newest fix.
const CLEAN = 'mcp/stdio/query/renderer.js';
const cleanFlags = flagCount(sourceAt('1e1a07d0', CLEAN), CLEAN);
const worstPre = Math.max(...rows.map((r) => r.pre ?? 0));
const discriminates = cleanFlags !== null && cleanFlags < worstPre;
say(`[${discriminates ? 'PASS' : 'FAIL'}] NEGATIVE CONTROL: ${CLEAN} flags ${cleanFlags}, `
  + `below the worst pre-fix file's ${worstPre} — the detector is not flagging everything`);

const caught = rows.filter((r) => r.caught).length;
say('');
say(`RECALL ON THE KNOWN POPULATION: ${caught} of ${rows.length} file-level defects caught.`);
if (caught === 0) {
  say('⛔ ABANDON RULE FIRES: the detector catches none of the class it exists for. Write that up.');
  say('   Do NOT tune the detector here — a screen tuned until it matches the expected answer is');
  say('   selecting its own result.');
}
say('');
say('⛔ CLAIM CEILING: recall on a known, fixed, tiny population. It says nothing about unknown');
say('   defects, and a perfect score here would not mean the fail-open class is closed.');
// Instrument health only, never the findings count — the same rule hazard-inventory.mjs holds.
process.exitCode = (anyPre && discriminates) ? 0 : 1;
