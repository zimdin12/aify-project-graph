// ⛔ A CUMULATIVE COUNTER CANNOT DECREASE — SO ONE DECREASE IS A PROOF, NOT A PREPONDERANCE.
//
// `reconcileTurnUsage` refuses on any non-decreasing multi-turn series, because a per-turn series
// grows naturally as context grows and a cumulative one grows by definition. Values alone cannot
// separate them, so the reading has to be DECLARED — and nothing had established it, which is what
// blocks the efficacy re-run.
//
// ⭐ THE DISCRIMINATOR NEEDS NO SECOND SOURCE. A decrease refutes the cumulative reading outright.
// That is stronger than the roadmap's "reconcile against a provider-reported total", which depends
// on the provider's total covering exactly this window and is ambiguous on a mismatch.
//
// ⚠ WHAT THIS DOES NOT DO. It cannot establish a host from a series that never decreases, and it
// refuses rather than guessing — a short run is exactly where a per-turn series looks cumulative by
// luck. That refusal is the feature.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';

const SCRIPT = 'scripts/establish-usage-semantics.mjs';
let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apg-usagesem-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true, maxRetries: 3 }));

// `turn.completed` shaped, because that is what the production collector reads.
function transcript(name, outputs) {
  const p = join(dir, `${name}.jsonl`);
  writeFileSync(p, `${outputs.map((v, i) => JSON.stringify({
    type: 'turn.completed', id: `t${i}`, usage: { input_tokens: 100 + i, output_tokens: v },
  })).join('\n')}\n`);
  return p;
}

// ⛔ THE EXIT CODE OF THE PROCESS UNDER TEST, not of something downstream of it. My first
// measurement of this script piped it through grep and read grep's status — every one of the four
// cases reported 0, including the two that exit 2 and the one that exits 1. A pipeline's `$?` is
// the LAST command's, and the last command was the reader, not the subject.
function run(path) {
  try {
    const stdout = execFileSync('node', [SCRIPT, path], { encoding: 'utf8' });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status, stdout: String(e.stdout ?? '') };
  }
}

describe('a decrease establishes per_turn', () => {
  it('★★★⛔ one decrease anywhere is enough, and it exits 0', () => {
    const r = run(transcript('dec', [500, 400, 900, 300]));
    expect(r.stdout).toMatch(/VERDICT: per_turn — ESTABLISHED/);
    expect(r.stdout, 'the evidence is named, not just the verdict').toMatch(/2 of 3 steps/);
    expect(r.code, 'established is a success exit').toBe(0);
  });

  it('★★★ a single late decrease still establishes it', () => {
    // The proof is existential: it does not need most steps to decrease, only one.
    const r = run(transcript('late', [100, 200, 300, 299]));
    expect(r.stdout).toMatch(/VERDICT: per_turn — ESTABLISHED/);
    expect(r.code).toBe(0);
  });
});

describe('what it REFUSES to establish', () => {
  it('★★★⛔ a rising series is CANNOT_ESTABLISH — never "probably cumulative"', () => {
    // ⛔ THE WHOLE DEFECT THIS AREA EXISTS FOR. [100,200,300] was once read as cumulative and
    // reported 300; the true total may be 600, because a per-turn series rises as context grows.
    // Guessing here is the original error wearing a new coat.
    const r = run(transcript('inc', [100, 200, 300, 400]));
    expect(r.stdout).toMatch(/VERDICT: CANNOT_ESTABLISH/);
    // ⚠ The canaries matter here: "CANNOT_ESTABLISH" does NOT contain "ESTABLISHED", so the
    // allowed form is a genuine near-miss rather than a comfortable one — which is the only kind
    // that proves the matcher discriminates instead of merely firing.
    expectAbsentWithLiveMatcher(
      /ESTABLISHED/,
      { forbidden: 'VERDICT: per_turn — ESTABLISHED.', allowed: 'VERDICT: CANNOT_ESTABLISH from this transcript.' },
      r.stdout,
      'a refusal must not name a winner anywhere in its output',
    );
    expect(r.code, 'a refusal is not a success').toBe(2);
  });

  it('★★★ a flat series is equally unestablishable', () => {
    const r = run(transcript('flat', [100, 100, 100]));
    expect(r.stdout).toMatch(/VERDICT: CANNOT_ESTABLISH/);
    expect(r.code).toBe(2);
  });

  it('★★★ one turn establishes nothing — semantics is a relation between turns', () => {
    const r = run(transcript('one', [100]));
    expect(r.stdout).toMatch(/CANNOT_ESTABLISH — one turn/);
    expect(r.code).toBe(2);
  });

  it('★★★⛔ a transcript with NO usage is distinguished from one that cannot decide', () => {
    // ⛔ Two different facts: "this file says nothing about usage" and "this file's usage is
    // ambiguous". Collapsing them would let an unparseable transcript read as an ambiguous one,
    // and the remedy for each is different — a different file versus a longer run.
    const p = join(dir, 'empty.jsonl');
    writeFileSync(p, `${JSON.stringify({ type: 'something.else' })}\n`);
    const r = run(p);
    expect(r.stdout).toMatch(/VERDICT: NO USAGE/);
    expect(r.code, 'distinct exit from the ambiguous case').toBe(1);
    expect(r.code).not.toBe(2);
  });
});

describe('the refusal tells you how to unblock it', () => {
  it('★★★ it names both routes and ranks them', () => {
    // A refusal without a next step is where this repo's remedies keep dying. The compaction route
    // is named first because it is the stronger one — a per-turn series drops sharply when context
    // resets and a cumulative one cannot.
    const r = run(transcript('inc2', [1, 2, 3]));
    expect(r.stdout).toMatch(/spanning a compaction/);
    expect(r.stdout).toMatch(/provider-reported total/);
    expect(r.stdout, 'and says why the second is weaker').toMatch(/Weaker, because/);
  });
});
