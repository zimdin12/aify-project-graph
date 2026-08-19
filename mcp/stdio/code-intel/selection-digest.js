// THE SELECTION DIGEST — what population APG SELECTED, and nothing about what was INDEXED.
//
// Specified by graph-senior-dev, 2026-08-19, after `evidence.exhaustive` was falsified three
// times in one day. Full spec and the 18 preregistered falsifiers:
// `docs/2026-08-19-selection-receipt-spec.md`.
//
// ⛔ THIS PROVES SELECTION, NOT SUCCESS. A translation unit in the compile DB is one clangd MAY
// index; whether it DID is unobserved. Nothing here may ever be read as a completeness or
// deletion-safety claim, and the receipt kind carrying it must be non-promotable.
//
// ⚠ THE ENCODING IS LENGTH-FRAMED FOR A REASON THIS REPO ALREADY PAID FOR: a delimiter-framed
// digest here previously produced ONE SHA-256 for TWO DIFFERENT TREES, because content could
// impersonate the next entry's header. Every variable-length field is preceded by its length.
//
// ⚠ VERIFIED AGAINST INDEPENDENT GOLDEN VECTORS. graph-senior-dev generated them from separate
// Python and Node implementations required to agree byte-for-byte, and no test may recompute an
// expected value through this codec — that is falsifier 14, shared-bug self-review. Those
// vectors resolved a real ambiguity in the spec text: inside the framed codec the file digest is
// embedded as RAW BYTES, not as a hex string. Both readings were defensible; only one is right.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve as resolvePath, relative as relativePath, sep } from 'node:path';

const DOMAIN_ROW = 'apg.compile-entry.v1';
const DOMAIN_SET = 'apg.selected-tu-set.v1';

const u64be = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
};

// F(x) = U64BE(byte_length(x)) || x
const frame = (x) => {
  const b = Buffer.isBuffer(x) ? x : Buffer.from(String(x), 'utf8');
  return Buffer.concat([u64be(b.length), b]);
};

const sha256 = (b) => createHash('sha256').update(b).digest();

// Project-relative, forward slashes, no leading slash, no `.`/`..`, NFC, CASE PRESERVED.
// Returns null when the path is not inside the project root.
//
// ⛔ THIS USED TO DO A LOWERCASED STRING-PREFIX CONTAINMENT CHECK ON EVERY OS, AND IT ADMITTED A
// POSIX SIBLING. graph-senior-dev executed it under WSL against this checkout: project root
// `/tmp/…/Repo`, source `/tmp/…/repo/src/x.cpp` — two DISTINCT case-sensitive trees — and the
// selector relabelled the outside source as `src/x.cpp` inside the root. That is a FALSE
// SELECTION BODY, not a missing-availability case: the receipt would have described a member
// that is not in the population it claims.
//
// ⇒ Delegate containment to `path.relative`, which is host-native: Windows handles drive and
// case semantics, POSIX stays byte-exact. It also fixes the mirror defect — `('C:/Repo',
// 'c:/repo')` used to return null instead of `.`, because the equality shortcut was
// case-SENSITIVE while the prefix test was case-INSENSITIVE. One rule now decides both.
export function canonicalRelative(projectRoot, candidate) {
  const root = resolvePath(String(projectRoot));
  const abs = resolvePath(String(candidate));
  const rel = relativePath(root, abs);
  if (rel === '') return '.';
  if (isAbsolute(rel)) return null;                      // different drive / unrelated root
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return null;
  return rel.split(sep).join('/').normalize('NFC');
}

// One entry row. `argv` must be the real argument vector, already validated as strings.
//
// ⛔ A WHITESPACE-SPLIT `command` STRING IS NOT AN ARGUMENT VECTOR and must never be hashed as
// one — quoting, embedded spaces and response files all break it, and the digest would silently
// describe a command nobody ran. `compile-db.js:200` does exactly that split for a toolchain
// heuristic, which is fine for a heuristic and disqualifying for an identity. Entries carrying
// only `command` make the digest UNAVAILABLE rather than approximate. clang itself does not
// split on whitespace either: it uses TokenizeWindowsCommandLine on Windows and its GNU command
// parser elsewhere, so any parser we reached for would have to match those or lie.
export function encodeEntryRow({ relPath, relDir, argv, rawBytes }) {
  return Buffer.concat([
    frame(DOMAIN_ROW),
    frame(String(relPath).normalize('NFC')),
    frame(String(relDir).normalize('NFC')),
    u64be(argv.length),
    ...argv.map((a) => frame(a)),
    u64be(rawBytes.length),
    frame(sha256(rawBytes)),
  ]);
}

// Rows sort by their COMPLETE ENCODED BYTES and duplicates are RETAINED — multiset semantics,
// so row count preserves multiplicity. Deduping here would let two different selections collide
// (falsifier 2); sorting by path alone would let two rows with equal paths reorder freely.
export function aggregateRows(rows) {
  const sorted = [...rows].sort(Buffer.compare);
  return sha256(Buffer.concat([
    frame(DOMAIN_SET),
    u64be(sorted.length),
    ...sorted.map(frame),
  ])).toString('hex');
}

// ⚠ ONE EXPORTED ENUM, not a syntax the tests grep for. graph-senior-dev asked for this and the
// cause-vocabulary guard proved why within the hour: its harvester matched the literal form
// `cause: '...'`, so refactoring these into a helper made it silently find ZERO causes. Its own
// "guards the harvester" assertion is the only reason that was noticed rather than passing as a
// clean run. A checker that cannot see its population will eventually certify an empty one.
export const RECEIPT_CAUSES = Object.freeze({
  NO_PROJECT_ROOT: 'no_project_root',
  NO_ENTRIES: 'no_entries',
  MALFORMED_ENTRY: 'malformed_entry',
  NO_ARGUMENT_VECTOR: 'no_argument_vector',
  ENTRY_OUTSIDE_PROJECT_ROOT: 'entry_outside_project_root',
  COMPILE_DIRECTORY_OUTSIDE_PROJECT_ROOT: 'compile_directory_outside_project_root',
  MAIN_FILE_UNREADABLE: 'main_file_unreadable',
  // Reserved: the transport budget is not wired in slice 1. Listed so the vocabulary is the
  // contract rather than a description of whatever the code happens to emit today.
  POPULATION_TRANSPORT_UNAVAILABLE: 'population_transport_unavailable',
});

const refuse = (cause, detail) => ({ available: false, cause, detail });

// Compute the digest for a set of normalized compile-DB entries.
//
// Returns `{ available: true, digest, rows }` or `{ available: false, cause, detail }`.
// ⛔ FAIL CLOSED, ALWAYS. None of the refusals below may silently drop a row: a smaller
// population that still calls itself complete is the denominator laundering this whole exercise
// exists to prevent.
export function selectedTuSetDigest({ projectRoot, entries, readFile = readFileSync }) {
  // ⛔ RETIRED: A CASE-FOLD ALIAS REFUSAL. graph-senior-dev's ruling, and it removes code rather
  // than adding it. The population here is explicitly a COMPILE-ENTRY MULTISET — two entries
  // that spell one physical file differently are still two selected entries, and the selector
  // never merges anything (byte-identical duplicates are already retained). So the check
  // protected nothing and cost availability, while `process.platform === 'win32'` was a STAND-IN
  // for a filesystem property: macOS commonly folds while `darwin` says false, and Windows
  // supports per-directory case-sensitive trees. If a future attestation needs a unique
  // physical-TU population, derive THAT as its own population from resolved identity; do not
  // retrofit uniqueness into compile-entry selection.
  if (typeof projectRoot !== 'string' || projectRoot === '') {
    return refuse(RECEIPT_CAUSES.NO_PROJECT_ROOT, 'projectRoot must be a non-empty string');
  }
  if (!Array.isArray(entries)) return refuse(RECEIPT_CAUSES.NO_ENTRIES, 'entries must be an array');

  const pairs = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') return refuse(RECEIPT_CAUSES.MALFORMED_ENTRY, 'entry is not an object');
    if (typeof entry.file !== 'string' || entry.file === '') {
      return refuse(RECEIPT_CAUSES.MALFORMED_ENTRY, 'entry has no non-empty file');
    }
    // ⛔ A MISSING `directory` WAS SILENTLY DEFAULTED TO THE PROJECT ROOT, so the receipt
    // described a carrier clangd never accepted — its JSONCompilationDatabase treats a missing
    // directory as an error. Inventing the field is exactly the stand-in defect this project
    // keeps producing: a plausible value in place of an absent one.
    if (typeof entry.directory !== 'string' || entry.directory === '') {
      return refuse(RECEIPT_CAUSES.MALFORMED_ENTRY, `entry for ${entry.file} has no non-empty directory`);
    }
    if (!Array.isArray(entry.arguments)) {
      return refuse(
        RECEIPT_CAUSES.NO_ARGUMENT_VECTOR,
        `entry for ${entry.file} carries only a command string; a whitespace split is not an `
          + 'argument vector and must not be hashed as one',
      );
    }
    // ⛔ NON-STRING ARGV WAS COERCED ON ONE SIDE AND EXPORTED RAW ON THE OTHER: the codec hashed
    // "7" and "[object Object]" while the body showed the number and the object. Two different
    // descriptions of one entry, from one call. clang rejects non-string arguments outright, so
    // refusing is also the behaviour that matches the carrier.
    if (!entry.arguments.every((a) => typeof a === 'string')) {
      return refuse(RECEIPT_CAUSES.MALFORMED_ENTRY, `entry for ${entry.file} has a non-string argument`);
    }
    // ⚠ CLONED BEFORE USE. The body used to export the caller's own array, so mutating it after
    // the call changed the published member while the digest stayed bound to the original —
    // graph-senior-dev executed that, flipping `-c` to `-O3` in the body of a `-c` digest. One
    // immutable snapshot now feeds both the row and the body.
    const argv = entry.arguments.slice();

    const abs = isAbsolute(entry.file) ? entry.file : join(entry.directory, entry.file);
    const relPath = canonicalRelative(projectRoot, abs);
    if (relPath === null) {
      return refuse(RECEIPT_CAUSES.ENTRY_OUTSIDE_PROJECT_ROOT, `${entry.file} resolves outside ${projectRoot}`);
    }
    const relDir = canonicalRelative(projectRoot, entry.directory);
    if (relDir === null) {
      // Spec: an external compile directory becomes a normalized absolute URI and the receipt is
      // marked portable:false. Deliberately NOT implemented in slice 1 — emitting a
      // representation the independent verifier does not share would fail replay for a reason
      // that is not a defect.
      return refuse(
        RECEIPT_CAUSES.COMPILE_DIRECTORY_OUTSIDE_PROJECT_ROOT,
        `${entry.directory} is outside ${projectRoot}; slice 1 does not emit non-portable receipts`,
      );
    }

    let rawBytes;
    try {
      rawBytes = readFile(abs);
    } catch {
      return refuse(
        RECEIPT_CAUSES.MAIN_FILE_UNREADABLE,
        `${relPath} could not be read; an unreadable file makes the digest unavailable, never a `
          + 'skipped row',
      );
    }

    pairs.push({
      row: encodeEntryRow({ relPath, relDir, argv, rawBytes }),
      // ⛔ THE BODY MUST DETERMINE ITS OWN DIGEST. Without `mainFileSha256` a same-length content
      // change produced a BYTE-IDENTICAL body with a different digest — graph-senior-dev executed
      // `int a;` -> `int b;` — so a second agent could not recompute the advertised value from the
      // body and had to possess the sender's mutable files. That defeats the entire point of a
      // self-contained receipt.
      // ⚠ HEX HERE, RAW BYTES INSIDE THE CODEC. Same 32 bytes, two representations, each correct
      // for its layer: the framed row is binary, the transported body is JSON.
      member: {
        path: relPath,
        directory: relDir,
        argv,
        mainFileBytes: rawBytes.length,
        mainFileSha256: sha256(rawBytes).toString('hex'),
      },
    });
  }

  // ⚠ MEMBERS ARE PUBLISHED IN THE DIGEST'S OWN ORDER, not the compile DB's array order.
  // Otherwise one multiset with one digest yields different content-addressed receipt IDs
  // depending on how the DB happened to be serialized. Not false authority, but canonical body
  // identity must not depend on input order.
  pairs.sort((a, b) => Buffer.compare(a.row, b.row));

  // ⛔ THE RETURNED BODY WAS STILL DIRECTLY MUTABLE AFTER THE DIGEST WAS FIXED. Removing the
  // caller-input alias was not enough: graph-senior-dev executed `r.rows[0].argv[1] = '-O3'` and
  // `r.rows[0].mainFileSha256 = '00…'` on the OUTPUT, and the digest stayed put while the body
  // moved. It matters precisely because wiring is a later step — a caller receives this object,
  // adds query/result/authority fields, then content-addresses the whole thing. An accidental
  // mutation anywhere in that interval yields a self-contained receipt that is internally
  // inconsistent, which is worse than one that is obviously incomplete.
  //
  // ⚠ And my test claiming "the selection body cannot be changed after the digest is fixed"
  // proved only INPUT isolation. The title asserted more than the body did — the same
  // over-claiming shape the whole receipt exists to prevent, inside its own test file.
  const rows = Object.freeze(pairs.map((p) => {
    Object.freeze(p.member.argv);
    return Object.freeze(p.member);
  }));
  return Object.freeze({
    available: true,
    digest: aggregateRows(pairs.map((p) => p.row)),
    rows,
  });
}
