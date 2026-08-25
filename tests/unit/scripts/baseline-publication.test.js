// ⛔ A REFUSED BASELINE MUST NOT SURVIVE ON DISK.
//
// `writeFileSync(ARTIFACT, ...)` used to run BEFORE the route-coverage and all-threw refusals. The
// refusal printed and exited 1 — and the artifact it had just written stayed there, ready for a
// later `--verify` to consume. the reviewer: *"a refused baseline must never masquerade as an
// attempted baseline."*
//
// ⚠ THESE SIDE EFFECTS WERE ONLY EVER INFERRED FROM READING THE ORDER. A test that asserts source
// ordering is trusting the same reading that missed it for weeks, so this executes the real
// exported publication step against a temp path.
//
// ⛔ WHAT THIS DOES NOT BIND: the process exit code and the CLI's argv routing. Those are exercised
// only by the end-to-end runs recorded in the commit message. Saying so rather than letting a green
// file imply the whole path is covered.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { publishBaseline } from '../../../scripts/refactor-guard.mjs';
import { VERDICT, REFUSAL } from '../../../scripts/lib/guard-verdict.mjs';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

let dir;
let artifact;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'guard-pub-')); artifact = join(dir, 'baseline.json'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const results = [{ target: 'A', mode: 'plan', outcome: 'ok', sha256: 'h', route: 'rA', routeExecuted: true }];
const carrier = { graphSha256: 'aaa', indexedCommit: 'c0', nodes: 1, edges: 2 };

describe('publishBaseline', () => {
  it('★★★ POSITIVE CONTROL: a PASS verdict actually writes a readable artifact', () => {
    // Without this, every assertion below is satisfied by a function that never writes anything.
    const ok = publishBaseline({ decision: { verdict: VERDICT.PASS, detail: [] }, artifactPath: artifact, carrier, results });
    expect(ok).toBe(true);
    expect(existsSync(artifact), 'the artifact exists').toBe(true);
    const parsed = JSON.parse(readFileSync(artifact, 'utf8'));
    expect(parsed.corpusSize).toBe(1);
    expect(parsed.carrier.graphSha256).toBe('aaa');
  });

  it('★★★ a REFUSED verdict writes nothing', () => {
    const ok = publishBaseline({
      decision: { verdict: VERDICT.REFUSE, reason: REFUSAL.ROUTES_UNREACHED, detail: [] },
      artifactPath: artifact, carrier, results,
    });
    expect(ok).toBe(false);
    expect(existsSync(artifact), 'no artifact from a refused attempt').toBe(false);
  });

  it('★★★ THE DEFECT: a refused attempt REMOVES the previous baseline', () => {
    // ⛔ Leaving the old one is worse than leaving nothing — the next verify would compare against
    // a population nobody chose, with no sign the replacement had failed.
    writeFileSync(artifact, JSON.stringify({ carrier, corpusSize: 99, results: [] }));
    expect(existsSync(artifact), 'a stale baseline is present before the attempt').toBe(true);

    const messages = [];
    const ok = publishBaseline({
      decision: { verdict: VERDICT.REFUSE, reason: REFUSAL.ALL_THREW, detail: [] },
      artifactPath: artifact, carrier, results, onMessage: (m) => messages.push(m),
    });
    expect(ok).toBe(false);
    expect(existsSync(artifact), 'the stale baseline is GONE').toBe(false);
    expect(messages.join(' '), 'and the removal is disclosed, not silent').toMatch(/REMOVED/);
  });

  it('★★★ no .tmp file is left behind on success', () => {
    publishBaseline({ decision: { verdict: VERDICT.PASS, detail: [] }, artifactPath: artifact, carrier, results });
    expect(existsSync(`${artifact}.tmp`), 'the temp file was renamed, not copied').toBe(false);
  });

  it('★★★ publishing REPLACES rather than appends — the artifact is the new run, not a merge', () => {
    writeFileSync(artifact, JSON.stringify({ carrier, corpusSize: 99, results: [{ target: 'OLD' }] }));
    publishBaseline({ decision: { verdict: VERDICT.PASS, detail: [] }, artifactPath: artifact, carrier, results });
    const parsed = JSON.parse(readFileSync(artifact, 'utf8'));
    expect(parsed.corpusSize).toBe(1);
    // ⛔ CONTROLLED ABSENCE. A bare not.toMatch here would pass even if the matcher could never
    // fire; the canaries prove it fires on the stale marker and does NOT fire on the new one.
    expectAbsentWithLiveMatcher(/OLD/, { forbidden: 'target: OLD', allowed: 'target: A' },
      JSON.stringify(parsed.results), 'the previous baseline content is gone, not merged');
  });
});
