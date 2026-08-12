// IDENTITY OF A GENERATED-STATE DIRECTORY (`.aify-graph`), AND WHAT IT REFUSES TO CLAIM.
//
// ⛔ The original walked only top-level FILES (`if (!st.isFile()) continue`), so two graph
// states differing solely in nested content shared a digest. That is the historical defect
// this module exists to close — and the discriminator for it (two trees with identical
// top-level entries, differing only underneath) is exactly what the first fix LACKED, which is
// why graph-senior-dev-hermes required this to be its own carrier with its own matrix rather
// than riding along with the receipt's commit-attribution row. Same file is not same proof.
//
// EXTRACTED so it can be tested at all: it previously lived inside suite-receipt.mjs, which
// runs the entire suite on import. A function that cannot be called cannot be falsified.
//
// ── STATED POLICIES, because each is a decision and silence would make it an assumption:
//
//  · FULL SHA-256, not a 16-hex prefix. The old value discarded 192 bits for readable output,
//    which is a formatting preference, not a collision policy. An identity claim does not get
//    to throw away three quarters of its evidence by default.
//  · DIRECTORY PRESENCE IS MATERIAL. An empty directory is part of the state, so every
//    directory contributes `D:<relpath>` whether or not it has contents. Creating an empty
//    directory CHANGES the identity. (If a caller ever wants content-only identity, that is a
//    different function with a different name — not a flag on this one.)
//  · PATH IS PART OF IDENTITY. Entries contribute their relative path, so renaming a nested
//    file changes the digest even when every byte in the tree is unchanged.
//  · TYPE IS PART OF IDENTITY. `F:` and `D:` prefixes differ, so replacing a file with a
//    directory of the same name changes the digest.
//  · FAIL CLOSED ON ANYTHING UNREADABLE OR SPECIAL. A symlink, socket, FIFO or unreadable
//    entry means the declared population was not covered, so NO digest is returned — an
//    incompleteness report is not an identity. `lstat` is used deliberately: `stat` follows
//    symlinks and would silently hash a target outside the population.
//  · ABSENCE IS TYPED, not a missing key: `{ present: false, reason }`.
import { readdirSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function graphIdentity(dir) {
  if (!existsSync(dir)) return { present: false, reason: 'absent (gitignored; repo not indexed here)' };

  const h = createHash('sha256');
  const entries = [];
  const problems = [];

  const walk = (abs, rel) => {
    let names;
    try { names = readdirSync(abs).sort(); }
    catch (e) { problems.push(`${rel || '.'}: unreadable directory (${e.code ?? e.message})`); return; }
    for (const name of names) {
      const childAbs = join(abs, name);
      const childRel = rel ? `${rel}/${name}` : name;
      let st;
      try { st = lstatSync(childAbs); }
      catch (e) { problems.push(`${childRel}: unstattable (${e.code ?? e.message})`); continue; }

      if (st.isSymbolicLink()) { problems.push(`${childRel}: symbolic link — target may lie outside the declared population`); continue; }
      if (st.isDirectory()) { h.update(`D:${childRel}\0`); entries.push(`${childRel}/`); walk(childAbs, childRel); continue; }
      if (!st.isFile()) { problems.push(`${childRel}: not a regular file (${st.isFIFO() ? 'fifo' : st.isSocket() ? 'socket' : 'special'})`); continue; }

      try {
        h.update(`F:${childRel}\0`).update(readFileSync(childAbs));
        entries.push(childRel);
      } catch (e) { problems.push(`${childRel}: unreadable (${e.code ?? e.message})`); }
    }
  };
  walk(dir, '');

  // ★ A digest that could not read part of its declared population is not an identity, and
  // annotating the gap would produce an INCOMPLETENESS RECEIPT wearing an identity's name.
  // dev's ruling, taken over my first proposal to annotate-and-continue.
  if (problems.length) {
    return { present: true, digest: null, entries, incomplete: problems, coverage: 'REFUSED — declared population not fully readable' };
  }
  return { present: true, digest: h.digest('hex'), entries, coverage: 'recursive: every entry, path, type and byte under the directory' };
}
