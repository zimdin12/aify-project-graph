// ⛔⛔ P0 — `exhaustive: true` WAS REPRODUCIBLY FALSE. review, 2026-08-19, executed
// against real clangd/clang-cl 22.1.6, two independent mechanisms, on committed bytes.
//
// COUNTEREXAMPLE 1 — A THRESHOLD GRANTED A BOOLEAN NAMED "EXHAUSTIVE".
// Ten valid TUs; `compile_commands.json` lists nine, omitting the one containing a second real
// caller. coverageRatio = 0.9, which is >= MIN_FIRST_PARTY_COVERAGE, so `poorlyCovered` was
// false, `complete` was true, no downgrade fired, and the verb returned
// `{exhaustive:true, degraded:false, cause:null, confidence:'high', warnings:[]}` — while
// omitting a caller that exists in the source. On a 1000-TU repo that is 100 caller-bearing
// TUs excluded, with the flag still granted.
//
// ★ The threshold's own comment admitted the residual risk — "A threshold does not make the
// remainder safe — it only bounds it" — and the code then converted that admitted risk into an
// unqualified boolean. That is the fail-open shape recorded in this project's memory as
// "absence of a limit is not permission", in the one field the whole product rests on.
//
// COUNTEREXAMPLE 2 — TWO POPULATIONS, DIFFERENT TIMES. References describe clangd's session
// population; coverage describes a SEPARATELY CACHED filesystem census (60s TTL). Adding a new
// caller-bearing source inside the TTL left the census reporting 9-on-disk when there were ten,
// and the grant was issued again. Same class as the whereis two-snapshot defect, in the field
// that licenses deletions.
//
// ⇒ THE RULE, and it is not a tuning change: NO THRESHOLD MAY GRANT A BOOLEAN NAMED EXHAUSTIVE.
// Either 100% of a declared source population is covered — and the census proving it was
// measured in THIS call, not recalled — or the answer is exhaustive:false naming the excluded
// population. A ratio is still reported, as a ratio.
//
// ⚠ The obvious objection, from the threshold's own comment: a healthy repo legitimately
// excludes some sources from a build, so 1.0 makes the contract unreachable. Accepted, and it
// does not change the answer. An unreachable-but-true contract is worth more than a
// reachable-but-false one, because the ONLY thing this field is for is licensing an
// irreversible action. The route to reachability is a DECLARED population, not a tolerance.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeCompileDbCoverage } from '../../../mcp/stdio/code-intel/compile-db.js';
import { buildReferencesEvidence } from '../../../mcp/stdio/query/verbs/code_intel_live.js';

const hostPath = (dir, rel) => path.join(dir, rel).split(path.sep).join('/');

describe('the exhaustive grant', () => {
  let repo;
  beforeEach(() => { repo = fs.mkdtempSync(path.join(os.tmpdir(), 'apg-exh-')); });
  afterEach(() => { try { fs.rmSync(repo, { recursive: true, force: true }); } catch { /* win lock */ } });

  // the reviewer's fixture, at the seam rather than through live clangd: ten first-party
  // translation units on disk, `covered` of them listed in compile_commands.json.
  function fixture(covered, total = 10) {
    fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
    for (let i = 0; i < total; i += 1) {
      fs.writeFileSync(path.join(repo, 'src', `tu${i}.cpp`), 'void f(){}\n');
    }
    const buildDir = hostPath(repo, 'build-win-clangd');
    const entries = [];
    for (let i = 0; i < covered; i += 1) {
      entries.push({ directory: buildDir, file: hostPath(repo, `src/tu${i}.cpp`), command: `clang-cl -c tu${i}.cpp` });
    }
    const dbPath = path.join(repo, 'build-win-clangd', 'compile_commands.json');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    fs.writeFileSync(dbPath, JSON.stringify(entries, null, 2));
    return computeCompileDbCoverage({ projectRoot: repo, env: {} });
  }

  it('★★★ 9 of 10 covered is NOT complete — the threshold may not grant the flag', () => {
    const cov = fixture(9);
    expect(cov.firstPartySourcesOnDisk, 'sanity: the fixture must have ten sources').toBe(10);
    expect(cov.firstPartySourcesCovered, 'sanity: nine must be in the DB').toBe(9);
    expect(cov.complete, 'a caller in the tenth TU is invisible to clangd; 0.9 cannot license a deletion')
      .toBe(false);
  });

  it('★★★ the withheld grant names the excluded population', () => {
    const cov = fixture(9);
    expect(cov.reason, 'exhaustive:false with no cause misdirects the remedy').toBeTruthy();
    expect(cov.reason, 'the reader must be able to size the risk').toMatch(/9 of|1 translation unit|unindexed/i);
  });

  it('★★★ 10 of 10 IS complete — the contract must stay reachable', () => {
    // The control. A fix that makes the flag unreachable in every case has not made the tool
    // honest, it has made the field useless, and the next person will loosen it back.
    const cov = fixture(10);
    expect(cov.complete, 'full coverage is the case the contract exists for').toBe(true);
    expect(cov.reason).toBeNull();
  });

  it('★★★ the evidence builder withholds exhaustive on the 9-of-10 coverage', () => {
    // End of the chain: coverage.complete === false must reach evidence.exhaustive === false.
    const cov = fixture(9);
    const ev = buildReferencesEvidence({
      freshness: 'fresh', callsiteCount: 1, defCount: 1, resultState: 'found', coverage: cov,
    });
    expect(ev.exhaustive).toBe(false);
    expect(ev.cause, 'a withheld grant must say why').toBeTruthy();
  });

  it('★★★ a RECALLED population census cannot authorize the grant', () => {
    // the reviewer's second counterexample: the on-disk census is TTL-cached, so a source
    // added in-session leaves the denominator describing a repo that no longer exists — and the
    // grant was re-issued. A cached denominator may not license an irreversible claim.
    const cov = fixture(10);
    const ev = buildReferencesEvidence({
      freshness: 'fresh',
      callsiteCount: 1,
      defCount: 1,
      resultState: 'found',
      coverage: { ...cov, censusFresh: false },
    });
    expect(ev.exhaustive, 'a recalled census may be describing a repo that has since changed')
      .toBe(false);
  });
});
