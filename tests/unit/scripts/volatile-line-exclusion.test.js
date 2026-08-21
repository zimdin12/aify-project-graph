// ⛔ THE GUARD'S ONE PROTECTION SWITCHED ITSELF OFF WHEN IT WAS NEEDED.
//
// refactor-guard does not scrub output generically — the referee named that class before I hit it
// ("a regex scrub is another way to erase a real drift"). It excludes exactly ONE named line, the
// packet SNAPSHOT banner, because `head` moves on every commit and `dirty` on every edit, so a
// baseline that included them would decay under the refactor it is guarding.
//
// The regex was anchored immediately after `trust=<tier>`. The producer appends ` STALE` whenever
// the indexed commit differs from HEAD — the NORMAL state during active work. So a stale line did
// not match, fell through to the COMPARED set, and carried a per-machine SHA into the baseline:
// the cry-wolf false refusal the design exists to prevent.
//
// ⇒ SIBLING OF bcaf565. The identical end-anchored spelling made a packet test unpassable on a
// stale graph. I fixed that site and did not sweep for the spelling, so this one lived on. The
// lesson these tests encode is not "widen a regex" — it is that ONE FIX IS NOT A SWEEP.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { expectAbsentWithLiveMatcher } from '../../helpers/live-matcher.js';
import { splitVolatile, volatileShapeOk } from '../../../scripts/refactor-guard.mjs';
import { snapshotLine } from '../../../mcp/stdio/query/verbs/packet-input.js';

const FRESH = 'SNAPSHOT: indexed=abc1234 head=abc1234 dirty=0 trust=high';
const STALE = 'SNAPSHOT: indexed=abc1234 head=def5678 dirty=3 trust=high STALE';

describe('the volatile SNAPSHOT line is excluded in every state it can occur in', () => {
  it('★★★ POSITIVE CONTROL: a fresh line is excluded, and ordinary text is not', () => {
    // Without both halves this passes for a function that excludes everything, which would erase
    // every real drift — the exact failure the no-generic-scrub rule exists to prevent.
    const r = splitVolatile([FRESH, 'nodes: 12', 'edges: 30'].join('\n'));
    expect(r.excluded).toEqual([FRESH]);
    expect(r.stable).toBe('nodes: 12\nedges: 30');
  });

  it('★★★⛔ A STALE LINE IS EXCLUDED TOO — the defect, as a permanent witness', () => {
    const r = splitVolatile([STALE, 'nodes: 12'].join('\n'));
    expect(r.excluded, 'a stale banner is still a volatile banner').toEqual([STALE]);
    expect(r.stable, 'its per-machine SHA must never reach the compared set').toBe('nodes: 12');
  });

  it('★★★⛔ THE PRODUCER AND THE GUARD AGREE — bound to real output, not to my spelling of it', () => {
    // ⛔ Two regexes written from the same mental model agree with each other and can both be
    // wrong; that is how the original defect shipped. This drives the REAL producer and feeds its
    // REAL bytes to the guard, so the assertion breaks if either side moves.
    // ⚠ FRESH MEANS "MATCHES THE REAL HEAD", not "a sha I chose". My first version passed an
    // invented commit for BOTH cases and the fresh one came back STALE — because staleness is
    // decided against the actual repository, never against the fixture's intent. The test caught
    // my error rather than my spelling, which is the whole reason it drives the real producer.
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const fresh = snapshotLine({ graph_commit: head }, { commit: head }, process.cwd());
    const stale = snapshotLine({ graph_commit: head }, { commit: 'b'.repeat(40) }, process.cwd());
    expect(stale, 'the stale fixture must actually be stale, or this proves nothing').toMatch(/ STALE$/);
    // ⚠ NOT a bare `not.toMatch`. The ratchet caught me adding one here, for the fifth time, and
    // it is right: a negative assertion passes both when the subject is clean AND when the matcher
    // is dead. The live matcher proves /STALE/ can fire (on the stale line) and that it does not
    // match everything, so this silence means something.
    expectAbsentWithLiveMatcher(
      /STALE/,
      { forbidden: stale, allowed: 'SNAPSHOT: indexed=x head=x dirty=0 trust=strong' },
      fresh,
      'a line whose indexed commit equals HEAD must not be marked stale',
    );
    expect(splitVolatile(fresh).excluded, 'fresh producer output').toEqual([fresh]);
    expect(splitVolatile(stale).excluded, 'stale producer output').toEqual([stale]);
  });

  it('★★★⛔ a line that merely RESEMBLES the banner is still compared', () => {
    // ⚠ The exclusion must stay narrow. Widening it to cover the stale suffix must not widen it
    // into a prefix match that swallows a genuinely different line.
    const impostor = 'SNAPSHOT: indexed=abc1234 head=def5678 dirty=3 trust=high STALE and then some';
    const r = splitVolatile(impostor);
    expect(r.excluded).toEqual([]);
    expect(r.stable).toBe(impostor);
  });

  it('★★★ `dirty=?` IS excluded now — the ledger entry, flipped as designed', () => {
    // ⚠ THIS ASSERTION USED TO BE ITS OWN OPPOSITE, on purpose. While safeDirtyCount returned 0 on
    // a failed git query, no input could produce `dirty=?` — and a guard no input can reach is
    // decoration, so widening the pattern early would have added a branch nothing could exercise.
    // The old test asserted the exclusion did NOT happen, and said in its body that it would fail
    // loudly in the commit that taught the producer to emit an unknown count. That commit is this
    // one, and the assertion inverted rather than being quietly deleted.
    const unknown = 'SNAPSHOT: indexed=? head=? dirty=? trust=missing';
    expect(splitVolatile(unknown).excluded, 'an unknown dirty count is still a volatile banner').toEqual([unknown]);
    expect(splitVolatile(unknown).stable, 'and must not reach the compared set').toBe('');
  });
});

// ⛔⛔ THE WORSE HALF OF THE SAME DEFECT: a WIRED control that could never fire.
//
// guard-verdict turns `!volatileShapeOk` into a FAIL, so this is not disclosure — the verdict moves
// on it. But the predicate was `excluded.every(pred)`, and `[].every(pred)` is VACUOUSLY TRUE. When
// the anchor stopped matching, `excluded` came back empty, `every` returned true, and the FAIL path
// became unreachable. The check that exists to notice a format change was disabled BY the format
// change, for as long as the tool has existed: all 61 corpus rows recorded `volatileLines: 0` beside
// `volatileShapeOk: true`.
describe('absence is a failure, not a vacuous pass', () => {
  it('★★★⛔ AN EMPTY EXCLUSION SET IS NOT "SHAPE OK" — the vacuous truth, pinned', () => {
    expect([].every((l) => /x/.test(l)), 'the language behaviour that caused it').toBe(true);
    expect(volatileShapeOk([]), 'but the guard must not inherit it').toBe(false);
  });

  it('★★★ POSITIVE CONTROL: exactly one well-formed banner IS shape-ok', () => {
    // Without this the assertions here are satisfied by a predicate that returns false always,
    // which would fail every run and get switched off within a day.
    expect(volatileShapeOk([FRESH])).toBe(true);
    expect(volatileShapeOk([STALE]), 'in both states the producer can emit').toBe(true);
  });

  it('★★★⛔ a malformed banner is refused, and so is more than one', () => {
    expect(volatileShapeOk(['SNAPSHOT: indexed=abc1234 trust=high']), 'missing fields').toBe(false);
    expect(volatileShapeOk([FRESH, STALE]), 'two banners in one packet is not the pinned shape').toBe(false);
  });
});
