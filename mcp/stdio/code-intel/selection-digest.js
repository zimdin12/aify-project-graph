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
// vectors resolved a real ambiguity in the spec text: the file digest is embedded as RAW BYTES,
// not as a hex string. Both readings were defensible and only one is correct.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, isAbsolute, resolve as resolvePath } from 'node:path';

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
// Returns null when the path escapes the project root — the caller decides what that means,
// because "outside the repo" is a portability fact, not a formatting failure.
export function canonicalRelative(projectRoot, absPath) {
  const root = resolvePath(projectRoot).replace(/\\/g, '/').replace(/\/+$/, '');
  const abs = resolvePath(absPath).replace(/\\/g, '/');
  if (abs === root) return '.';
  const prefix = `${root}/`;
  // Case-insensitive containment check for Windows hosts, but the RETURNED path keeps the
  // original bytes: merging two paths that differ only by case is falsifier 4.
  if (abs.toLowerCase().startsWith(prefix.toLowerCase())) {
    return abs.slice(prefix.length).normalize('NFC');
  }
  return null;
}

// One entry row. `argv` must be the real argument vector.
//
// ⛔ A WHITESPACE-SPLIT `command` STRING IS NOT AN ARGUMENT VECTOR and must never be hashed as
// one — quoting, embedded spaces and response files all break it, and the digest would silently
// describe a command nobody ran. `compile-db.js:200` does exactly that split for a toolchain
// heuristic, which is fine for a heuristic and disqualifying for an identity. Entries carrying
// only `command` therefore make the digest UNAVAILABLE rather than approximate.
export function encodeEntryRow({ relPath, relDir, argv, rawBytes }) {
  return Buffer.concat([
    frame(DOMAIN_ROW),
    frame(String(relPath).normalize('NFC')),
    frame(String(relDir).normalize('NFC')),
    u64be(argv.length),
    ...argv.map((a) => frame(String(a))),
    u64be(rawBytes.length),
    frame(sha256(rawBytes)),
  ]);
}

// Rows sort by their COMPLETE ENCODED BYTES and duplicates are RETAINED — multiset semantics,
// so row count preserves multiplicity. Deduping here would let two different selections collide
// (falsifier 2), and sorting by path alone would let two rows with equal paths reorder freely.
export function aggregateRows(rows) {
  const sorted = [...rows].sort(Buffer.compare);
  return sha256(Buffer.concat([
    frame(DOMAIN_SET),
    u64be(sorted.length),
    ...sorted.map(frame),
  ])).toString('hex');
}

// Compute the digest for a set of normalized compile-DB entries.
//
// Returns `{ available: true, digest, rows }` or `{ available: false, cause, detail }`.
// ⛔ FAIL CLOSED, ALWAYS. An unreadable main file, an entry outside the project root, an entry
// without a real argument vector, or a case-fold path collision all make the digest
// UNAVAILABLE. None of them may silently drop a row: a smaller population that still calls
// itself complete is the denominator laundering this whole exercise exists to prevent.
export function selectedTuSetDigest({ projectRoot, entries, readFile = readFileSync }) {
  if (!Array.isArray(entries)) {
    return { available: false, cause: 'no_entries', detail: 'entries must be an array' };
  }
  const rows = [];
  const members = [];
  const seenFold = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry.file !== 'string') {
      return { available: false, cause: 'malformed_entry', detail: 'entry has no file' };
    }
    if (!Array.isArray(entry.arguments)) {
      return {
        available: false,
        cause: 'no_argument_vector',
        detail: `entry for ${entry.file} carries only a command string; a whitespace split is `
          + 'not an argument vector and must not be hashed as one',
      };
    }
    const dir = typeof entry.directory === 'string' ? entry.directory : projectRoot;
    const abs = isAbsolute(entry.file) ? entry.file : join(dir, entry.file);
    const relPath = canonicalRelative(projectRoot, abs);
    if (relPath === null) {
      return {
        available: false,
        cause: 'entry_outside_project_root',
        detail: `${entry.file} resolves outside ${projectRoot}`,
      };
    }
    const relDir = canonicalRelative(projectRoot, dir);
    if (relDir === null) {
      // Spec: an external compile directory becomes a normalized absolute URI and the receipt
      // is marked portable:false. Not implemented in slice 1 — refuse rather than invent a
      // representation the verifier does not share.
      return {
        available: false,
        cause: 'compile_directory_outside_project_root',
        detail: `${dir} is outside ${projectRoot}; slice 1 does not emit non-portable receipts`,
      };
    }
    const fold = relPath.toLowerCase();
    const prior = seenFold.get(fold);
    if (prior !== undefined && prior !== relPath) {
      return {
        available: false,
        cause: 'path_alias_collision',
        detail: `${prior} and ${relPath} case-fold equal; merging them would hide a member`,
      };
    }
    seenFold.set(fold, relPath);

    let rawBytes;
    try {
      rawBytes = readFile(abs);
    } catch {
      return {
        available: false,
        cause: 'main_file_unreadable',
        detail: `${relPath} could not be read; an unreadable file makes the digest unavailable, `
          + 'never a skipped row',
      };
    }
    rows.push(encodeEntryRow({ relPath, relDir, argv: entry.arguments, rawBytes }));
    members.push({ path: relPath, directory: relDir, argv: entry.arguments, bytes: rawBytes.length });
  }

  return { available: true, digest: aggregateRows(rows), rows: members };
}
