// GOLDEN VECTORS FROM AN INDEPENDENT IMPLEMENTATION — falsifier 14, shared-bug self-review.
//
// ⛔ THE RULE THAT MAKES THIS TEST WORTH ANYTHING: no expected value below is computed by the
// production codec. the reviewer generated them from separate Python and Node
// implementations required to agree byte-for-byte, from the spec text rather than from our
// code. If this file ever computes an expectation through `selection-digest.js`, it stops
// testing conformance and starts asserting that a function equals itself.
//
// ★ THEY IMMEDIATELY EARNED THEIR KEEP. The spec says the row embeds `F(SHA256(raw_bytes))`,
// which reads equally well as the 32 raw digest bytes or as the 64-character hex string. Both
// are defensible; only RAW BYTES matches. I had a 50/50 guess and the oracle settled it before
// a line of consuming code existed.
//
// ⚠ Known-answer vectors are an oracle for CONFORMANCE, not for TRUTH — the reviewer's own
// caveat. If their reading of the spec is wrong, two implementations agree on the wrong thing.
// The independent selector fixtures below, and their post-implementation review of emitted
// bodies, are what cover that layer. No single oracle eliminates a bad specification.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeEntryRow, aggregateRows, canonicalRelative } from '../../../mcp/stdio/code-intel/selection-digest.js';

const ASCII = Buffer.from('int a;\n', 'utf8');
const UNICODE = Buffer.from('// café\n'.normalize('NFC'), 'utf8');

// Frozen, from the reviewer. Do not regenerate these locally.
const VECTORS = {
  raw_ascii_sha: '386593f1475dc210d45a5f3d4b6bb11c065fc6fe2e08ebdd00ab4cf3a0848744',
  raw_unicode_sha: '14952601d4c2321aea9341ebb808fea2eed00877cbf362c62b4745421b46b387',
  empty: 'c9857f9b44596d267172b4419f9c66f6bea8b862ebe5ba44752e8aa2a266574d',
  one_ascii: '1c8c0584927b70c781fe3fb09a68aac0573436be1b9a87178859008cd1d4c211',
  argv_ab_c: '1a617623c183d2e312cb4dbab97d9a81d18c56b593db41cf6ddea8b317de6a3b',
  argv_a_bc: 'e2a19f119fd1361432cbd4a599929dbf22da890532a9208112951729b320bebe',
  duplicate: '4c53d32df63e523c955d58f00ed41cf9bd35f602f4681b6d9f12a791537637db',
  unicode_nfc: 'a19446d9ad0c01d73a0c3fba17be59dec4487394cb0581a53cf234eafee7002b',
};

const row = (relPath, argv, rawBytes) =>
  encodeEntryRow({ relPath, relDir: '.', argv, rawBytes });

describe('selected_tu_set_digest — independent golden vectors', () => {
  it('★ the fixture bytes themselves hash as specified (guards the inputs, not the codec)', () => {
    expect(createHash('sha256').update(ASCII).digest('hex')).toBe(VECTORS.raw_ascii_sha);
    expect(createHash('sha256').update(UNICODE).digest('hex')).toBe(VECTORS.raw_unicode_sha);
  });

  it('★★★ empty selection', () => {
    expect(aggregateRows([])).toBe(VECTORS.empty);
  });

  it('★★★ one ascii entry', () => {
    const r = row('src/a.cpp', ['clang++', '-c', 'src/a.cpp'], ASCII);
    expect(aggregateRows([r])).toBe(VECTORS.one_ascii);
  });

  it('★★★ argv boundaries: ["ab","c"] and ["a","bc"] must differ', () => {
    // Falsifier 3. If argv were joined before hashing, these two collide and a receipt could
    // describe a command nobody ran while matching one that was.
    const abc = aggregateRows([row('src/a.cpp', ['clang++', 'ab', 'c'], ASCII)]);
    const a_bc = aggregateRows([row('src/a.cpp', ['clang++', 'a', 'bc'], ASCII)]);
    expect(abc).toBe(VECTORS.argv_ab_c);
    expect(a_bc).toBe(VECTORS.argv_a_bc);
    expect(abc).not.toBe(a_bc);
  });

  it('★★★ duplicates are RETAINED — a multiset, not a set', () => {
    // Falsifier 2's neighbour: silently deduping would let two different selections agree.
    const r = row('src/a.cpp', ['clang++', '-c', 'src/a.cpp'], ASCII);
    const two = aggregateRows([r, r]);
    expect(two).toBe(VECTORS.duplicate);
    expect(two).not.toBe(VECTORS.one_ascii);
  });

  it('★★★ unicode path and content, NFC', () => {
    const p = 'src/café.cpp'.normalize('NFC');
    expect(aggregateRows([row(p, ['clang++', '-c', p], UNICODE)])).toBe(VECTORS.unicode_nfc);
  });
});

describe('selected_tu_set_digest — metamorphic properties', () => {
  const a = () => row('src/a.cpp', ['clang++', '-c', 'src/a.cpp'], ASCII);
  const b = () => row('src/b.cpp', ['clang++', '-c', 'src/b.cpp'], ASCII);

  it('★★★ row ORDER is invariant — sorting is by complete encoded bytes', () => {
    expect(aggregateRows([a(), b()])).toBe(aggregateRows([b(), a()]));
  });

  it('★★★ one changed argv byte changes the digest', () => {
    expect(aggregateRows([row('src/a.cpp', ['clang++', '-c', 'src/a.cpp'], ASCII)]))
      .not.toBe(aggregateRows([row('src/a.cpp', ['clang++', '-O2', 'src/a.cpp'], ASCII)]));
  });

  it('★★★ one changed content byte changes the digest', () => {
    expect(aggregateRows([row('src/a.cpp', ['clang++'], ASCII)]))
      .not.toBe(aggregateRows([row('src/a.cpp', ['clang++'], Buffer.from('int b;\n', 'utf8'))]));
  });

  it('★★★ NFC-equivalent path spellings converge BEFORE encoding', () => {
    // Decomposed and composed forms of the same name are the same file. They must not produce
    // two members — that is a phantom row, the mirror of a dropped one.
    const composed = 'src/café.cpp'.normalize('NFC');
    const decomposed = 'src/cafe\u0301.cpp';
    expect(decomposed.normalize('NFC')).toBe(composed);
    expect(aggregateRows([row(decomposed, ['clang++'], ASCII)]))
      .toBe(aggregateRows([row(composed, ['clang++'], ASCII)]));
  });

  const WIN = process.platform === 'win32';

  it.runIf(!WIN)('★★★ a case-SIBLING tree is NOT inside the root (the executed WSL defect)', () => {
    // ⛔ the reviewer ran this under WSL against this checkout. `canonicalRelative`
    // lowercased both sides on EVERY OS, so `/tmp/…/repo/src/x.cpp` was relabelled as
    // `src/x.cpp` inside `/tmp/…/Repo` — two distinct POSIX trees. That is a FALSE SELECTION
    // BODY: the receipt names a member that is not in the population it claims. Containment is
    // now delegated to path.relative, which is host-native and byte-exact here.
    expect(canonicalRelative('/tmp/apg/Repo', '/tmp/apg/repo/src/x.cpp')).toBeNull();
    expect(canonicalRelative('/tmp/apg/Repo', '/tmp/apg/repo/build')).toBeNull();
    expect(canonicalRelative('/tmp/apg/Repo', '/tmp/apg/Repo/src/x.cpp')).toBe('src/x.cpp');
  });

  it.runIf(WIN)('★★★ a same-root CASING difference IS the root (the mirror defect)', () => {
    // The equality shortcut was case-SENSITIVE while the prefix test was case-INSENSITIVE, so
    // ('C:/Repo','c:/repo') returned null instead of '.'. One host-native rule decides both now.
    expect(canonicalRelative('C:/Repo', 'c:/repo')).toBe('.');
    expect(canonicalRelative('C:/Repo', 'c:/repo/src/x.cpp')).toBe('src/x.cpp');
  });

  it('★★★ canonicalRelative PRESERVES case and refuses escapes', () => {
    // Falsifier 4: `A.cpp` and `a.cpp` must stay distinct even on a case-insensitive host.
    const root = process.platform === 'win32' ? 'C:/repo' : '/repo';
    expect(canonicalRelative(root, `${root}/src/A.cpp`)).toBe('src/A.cpp');
    expect(canonicalRelative(root, `${root}/src/a.cpp`)).toBe('src/a.cpp');
    expect(canonicalRelative(root, `${root}/x/../y.cpp`), 'no . or .. survives').toBe('y.cpp');
    expect(canonicalRelative(root, process.platform === 'win32' ? 'C:/other/z.cpp' : '/other/z.cpp'))
      .toBeNull();
  });
});
