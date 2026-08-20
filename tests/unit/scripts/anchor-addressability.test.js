// ⛔ THREE DENOMINATORS, AND THEY ARE NOT THE SAME NUMBER.
//
//     declared specs                35   entries under tests/self-review/
//     ADDRESSABLE anchors           35   the anchor resolves to exactly one site in its file
//     behaviourally executed        ??   what self-review actually runs — NOT measured here
//
// ⚠ THIS FILE PROVES ADDRESSABILITY ONLY. graph-senior-dev's wording, and it is the right wording:
// *"a unique present anchor proves mutation transport can locate a site; it does not prove the
// mutation lands, changes behaviour, reaches the route, or produces the predicted failure."*
// Nothing here executes a hostile mutation or observes a red test. **Addressable is not witnessed.**
//
// ⛔ WHAT THE PROBLEM ACTUALLY IS: discoverability and rot latency, NOT silent acceptance.
// `self-review.mjs` already fails closed on an unresolvable anchor — it records INVALID and runs
// nothing. But nothing invoked those specs routinely, so two of them sat unaddressable through a
// refactor with no signal. This gate makes anchor rot surface on every suite run instead of
// whenever someone next remembers the tool exists.
//
// ⚠ AND IT DOES NOT MEAN SELF-REVIEW RAN. A green run here says the specs can still find their
// sites. It says nothing about whether anybody executed them.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// ⛔ THE PRODUCTION RESOLVER, not a second interpretation. A test-side occurrence counter would be
// a different opinion about what "the site" means, and the one that governs mutation would be the
// one nobody tested.
import { resolveAnchor, applyAnchor, ANCHOR_REASON } from '../../../scripts/lib/anchor.mjs';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC_DIR = join(REPO, 'tests', 'self-review');

/** Every declared spec entry, derived PHYSICALLY from the directory — no maintained filename list. */
function declaredSpecs() {
  const out = [];
  for (const file of readdirSync(SPEC_DIR)) {
    if (!file.endsWith('.json')) continue;
    for (const entry of JSON.parse(readFileSync(join(SPEC_DIR, file), 'utf8'))) {
      out.push({ spec: file, ...entry });
    }
  }
  return out;
}

describe('every declared self-review anchor is ADDRESSABLE', () => {
  it('★★★ the population is real and derived from disk', () => {
    // ⛔ POSITIVE CONTROL FIRST. "No unresolvable anchors" is trivially true of an empty walk, and
    // a wrong zero here agrees with exactly what we hope to see.
    const specs = declaredSpecs();
    expect(specs.length, 'declared witnesses').toBe(35);
    expect(new Set(specs.map((s) => s.spec)).size, 'across several spec files').toBeGreaterThan(1);
  });

  it('★★★ every spec ID is unique — two arms cannot share an identity', () => {
    const names = declaredSpecs().map((s) => s.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes, 'a duplicated spec name makes its report unattributable').toEqual([]);
  });

  it('★★★ every target file exists', () => {
    const missing = declaredSpecs()
      .filter((s) => !existsSync(join(REPO, s.file)))
      .map((s) => `${s.name} -> ${s.file}`);
    expect(missing, 'a spec pointing at a deleted file can never mutate').toEqual([]);
  });

  it('★★★ every anchor resolves UNIQUE, and absent/duplicate are reported separately', () => {
    // ⛔ TWO DEAD ANCHORS WERE FOUND THIS WAY. F6 and G8 were ABSENT because refactors moved their
    // code — packet.js -> packet-symbol.js, and server.js -> tools/schema.js. Both were repaired by
    // correcting the FILE, with the ruling recorded in the spec, because the hostile mutation and
    // the predicted failure were unchanged. Neither was retargeted to convenient nearby prose.
    const absent = [];
    const duplicate = [];
    for (const s of declaredSpecs()) {
      const r = resolveAnchor(readFileSync(join(REPO, s.file), 'utf8'), s.from);
      if (r.state === 'absent') absent.push(`${s.name} -> ${s.file}`);
      if (r.state === 'duplicate') duplicate.push(`${s.name} -> ${s.file} at ${r.occurrences.join(', ')}`);
      if (r.state === 'invalid') absent.push(`${s.name} -> INVALID: ${r.reason}`);
    }
    // Distinct failures, because they demand different remedies: retarget the spec, versus
    // disambiguate it.
    expect(absent, 'anchors that cannot be located — retarget the spec').toEqual([]);
    expect(duplicate, 'anchors matching several sites — disambiguate the spec').toEqual([]);
  });

  it('★★★ the inventory reports its three states over the whole population', () => {
    const tally = { unique: 0, absent: 0, duplicate: 0, invalid: 0 };
    for (const s of declaredSpecs()) {
      tally[resolveAnchor(readFileSync(join(REPO, s.file), 'utf8'), s.from).state]++;
    }
    expect(tally, 'ADDRESSABLE — not witnessed, not executed')
      .toEqual({ unique: 35, absent: 0, duplicate: 0, invalid: 0 });
  });
});

// ⛔ SYNTHETIC, AND SAID SO. The live population has ZERO duplicate anchors, so the corpus cannot
// exercise the arm that matters most. Without these controls the 35/35 above would imply the
// duplicate path works when nothing had ever run it.
describe('the resolver distinguishes three states — synthetic controls', () => {
  const SRC = 'const a = 1;\nconst target = TWICE;\nconst b = 2;\nconst c = TWICE;\n';

  it('★★★ EXACTLY ONE -> unique, and the mutation is applied at that offset', () => {
    const r = resolveAnchor(SRC, 'const target = TWICE;');
    expect(r.state).toBe('unique');
    const applied = applyAnchor(SRC, 'const target = TWICE;', 'const target = ONCE;');
    expect(applied.applied).toBe(true);
    expect(applied.after).toContain('const target = ONCE;');
    // Exactly ONE site changed: the other TWICE is untouched.
    expect(applied.after.split('TWICE').length - 1, 'one replacement, not a global sweep').toBe(1);
  });

  it('★★★ ZERO -> absent, distinct reason, and NOT ONE BYTE CHANGES', () => {
    const r = resolveAnchor(SRC, 'const nothing = HERE;');
    expect(r.state).toBe('absent');
    const applied = applyAnchor(SRC, 'const nothing = HERE;', 'anything');
    expect(applied.applied).toBe(false);
    expect(applied.reason).toBe(ANCHOR_REASON.absent);
    expect(applied.after, 'byte-identical').toBe(SRC);
  });

  it('★★★ TWO OR MORE -> duplicate, distinct reason, offsets reported, NOT ONE BYTE CHANGES', () => {
    // ⛔ THE ARM THAT WAS BROKEN. `String.replace` with a string mutates the FIRST site and returns
    // a changed source, so the old `after === before` test saw a successful mutation and the run
    // attributed its result to a site nobody chose.
    const r = resolveAnchor(SRC, 'TWICE');
    expect(r.state).toBe('duplicate');
    expect(r.occurrences.length).toBe(2);

    const applied = applyAnchor(SRC, 'TWICE', 'ONCE');
    expect(applied.applied, 'ambiguous must not mutate').toBe(false);
    expect(applied.reason).toBe(ANCHOR_REASON.duplicate);
    expect(applied.occurrences, 'and it says WHERE, so the spec can be disambiguated').toEqual(r.occurrences);
    expect(applied.after, 'byte-identical — a rejected duplicate leaves the target untouched').toBe(SRC);

    // ⛔ AND THE OLD BEHAVIOUR IS PINNED AS THE THING WE REJECT.
    expect(SRC.replace('TWICE', 'ONCE'), 'String.replace WOULD have mutated one site')
      .not.toBe(SRC);
  });

  it('★★★ OVERLAP: counting is NON-OVERLAPPING, stated because it changes the number', () => {
    // `aa` in `aaa` is ONE occurrence here, not two. Overlapping matches cannot both be replaced —
    // mutating one destroys the other — so the count that governs mutation uses the same semantics.
    expect(resolveAnchor('aaa', 'aa')).toEqual({ state: 'unique', index: 0 });
    expect(resolveAnchor('aaaa', 'aa').state, 'four a-s hold two non-overlapping pairs').toBe('duplicate');
  });

  it('★★★ FAIL CLOSED on a degenerate anchor', () => {
    // An empty string is "found" at every position. Without this an empty `from` would resolve as
    // duplicate-everywhere, or mutate at offset 0 — a guard that accepts a missing input is
    // decoration.
    expect(resolveAnchor(SRC, '').state).toBe('invalid');
    expect(applyAnchor(SRC, '', 'x').after, 'and still changes nothing').toBe(SRC);
    expect(resolveAnchor(null, 'x').state).toBe('invalid');
  });
});
