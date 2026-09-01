// One collection's view of the documents it validated against.
//
// ⛔ WHY THIS EXISTS. The coherence guard reads a document to check that a Location's range is in
// bounds and covers the claimed token. Without reuse that is ONE READ PER LOCATION. From this
// repository's stored records, a single collection has held 56,129 locations across 268 distinct
// files — roughly 209 reads per file if uncached.
//
// ⚠ THAT IS SNAPSHOT ARITHMETIC, NOT A TRACED RUN. It bounds how much repetition is available to
// eliminate; it is not a latency measurement and no latency claim exists. An earlier draft of mine
// reported "269x amplification" from 172,468 records over 640 files — those rows span SIX
// collections and the C++ provider contributes none. Sound arithmetic, wrong noun. The architecture
// defect stands without any number: one read per admitted Location, no reuse.
//
// ★ ONE COLLECTION, ONE VIEW — AND THAT IS THE CONTRACT, NOT A LIMITATION.
// The first captured bytes ARE the collection's document snapshot. A disk edit during the
// collection does not invalidate or replace them, and NO change-detection claim is made within a
// collection. Edits BETWEEN collections are observed, because each collection gets a fresh
// snapshot. Re-stat-on-hit would add a syscall per Location and weaken the resource guarantee this
// facility exists to provide.
//
// There is deliberately NO eviction, so one file can never be read twice in one collection and no
// second byte authority can arise. A `FILE_CHANGED_DURING_COLLECTION` reason would therefore be
// unreachable — the same unkillable-branch shape deleted from cpp.js earlier in this arc. If
// eviction is ever introduced, that reason arrives with it and with a producer that can be killed.
import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT_REASONS = Object.freeze({
  // ⚠ A DIRECTORY IS NOT MERELY UNREADABLE. Collapsing the two would turn the load-bearing
  // directory-URI refusal (proven INVALID) into a generic unavailable (merely unverified), which
  // is a weaker outcome and would let an incoherent Location pass as an honest unknown.
  DIRECTORY: 'directory_uri',
  UNREADABLE: 'file_status_unavailable',
  COUNT_BUDGET: 'document_count_budget_exhausted',
  BYTES_BUDGET: 'document_bytes_budget_exhausted',
});

// ⚠ DEFAULTS COME FROM A MEMORY BUDGET, NOT FROM THE LARGEST COLLECTION WE HAPPEN TO HAVE SEEN.
// Fitting a limit to today's data and calling the fit a justification is how a bound stops being a
// bound. Both are overrideable WITHOUT changing evidence semantics.
export const DEFAULT_MAX_DOCUMENTS = 4096;
export const DEFAULT_MAX_RETAINED_BYTES = 256 * 1024 * 1024;

// Canonical LOCAL FILE IDENTITY, not URI spelling.
//
// ⛔ NOT LOWERCASED. An earlier draft lowercased the whole Windows path, which would ALIAS TWO
// DISTINCT FILES on a case-sensitive directory — violating the stronger obligation that different
// files never collapse to one key, in order to satisfy the weaker one that spellings of the same
// file do. `realpath` already collapses 8.3 short names and junctions with filesystem authority;
// beyond separator and drive-letter normalization, no case folding is claimed.
function defaultRealpath(p) {
  try { return fs.realpathSync.native(p); }
  catch { try { return fs.realpathSync(p); } catch { return p; } }
}

function canonicalKey(filePath, realpath) {
  let resolved = realpath(path.resolve(filePath));
  resolved = resolved.split('\\').join('/');
  return resolved.replace(/^([A-Za-z]):/, (_, drive) => `${drive.toUpperCase()}:`);
}

export function createDocumentSnapshot({
  maxDocuments = DEFAULT_MAX_DOCUMENTS,
  maxRetainedBytes = DEFAULT_MAX_RETAINED_BYTES,
  // ⚠ I/O SEAMS, INJECTED SO THE ANTI-ALIAS CONTROL RUNS ON EVERY HOST. A test that only executes
  // on a case-sensitive filesystem would silently disappear on the machine most likely to alias.
  // With `realpath` alone the reads would still hit the real filesystem, so a case-insensitive host
  // would serve the SAME file for both keys and 'each Location validated against its own bytes'
  // could not be asserted. These three seams keep the deterministic control hermetic; the caching,
  // keying and budget logic under test are the real ones.
  realpath = defaultRealpath,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  statSize = (p) => fs.statSync(p).size,
} = {}) {
  const documents = new Map(); // key -> { ok:true, text, bytes } | { ok:false, reason }
  let retainedBytes = 0;
  let readsAttempted = 0;
  let statsAttempted = 0;
  let cacheHits = 0;
  // ⚠ Counts refused LOCATIONS, not unique documents — the keys are not retained, so the distinct
  // document identities behind these refusals are untracked and must not be implied.
  let countBudgetRefusals = 0;
  let bytesBudgetRefusals = 0;   // cached as a typed failure: consumes a key, retains no content

  return {
    /** @returns {{status:'ok', text:string}|{status:'unavailable', reason:string}} */
    read(filePath) {
      const key = canonicalKey(filePath, realpath);

      const hit = documents.get(key);
      if (hit) {
        cacheHits += 1;
        // A cached FAILURE is served too — a flood of missing paths, or one oversized file
        // referenced hundreds of times, must not re-enter the filesystem.
        return hit.ok ? { status: 'ok', text: hit.text } : { status: 'unavailable', reason: hit.reason };
      }

      // ⛔ COUNT CEILING: refuse WITHOUT filesystem access and WITHOUT consuming a key. Caching
      // these would let an unbounded stream of unseen documents grow the map past the very bound
      // that just fired.
      if (documents.size >= maxDocuments) {
        countBudgetRefusals += 1;
        return { status: 'unavailable', reason: SNAPSHOT_REASONS.COUNT_BUDGET };
      }

      // ⚠ `stat` IS A RESOURCE PREFLIGHT, NEVER COHERENCE AUTHORITY. It only avoids reading a file
      // already known not to fit. It never decides whether a Location is valid.
      statsAttempted += 1;
      try {
        if (retainedBytes + statSize(key) > maxRetainedBytes) {
          // ⛔ CACHED, unlike a count refusal. One oversized file referenced 200 times would
          // otherwise be re-stat'd 200 times — the refusal path recreating the I/O this facility
          // exists to remove. It consumes a key and retains zero content bytes.
          documents.set(key, { ok: false, reason: SNAPSHOT_REASONS.BYTES_BUDGET });
          bytesBudgetRefusals += 1;
          return { status: 'unavailable', reason: SNAPSHOT_REASONS.BYTES_BUDGET };
        }
      } catch { /* fall through: the read below is the authority on readability */ }

      readsAttempted += 1;
      let text;
      try {
        text = readFile(key);
      } catch (error) {
        // Classify the failure: a directory is a different fact from an unreadable file, and the
        // caller's refusal semantics differ between them.
        let isDirectory = error?.code === 'EISDIR';
        if (!isDirectory) {
          try { isDirectory = fs.statSync(key).isDirectory(); } catch { isDirectory = false; }
        }
        const reason = isDirectory ? SNAPSHOT_REASONS.DIRECTORY : SNAPSHOT_REASONS.UNREADABLE;
        documents.set(key, { ok: false, reason });
        return { status: 'unavailable', reason };
      }

      // The ACTUAL byte length is authoritative — a stat can under-report, and admitting on the
      // preflight's word would let the retained total drift past its ceiling.
      const bytes = Buffer.byteLength(text, 'utf8');
      if (retainedBytes + bytes > maxRetainedBytes) {
        documents.set(key, { ok: false, reason: SNAPSHOT_REASONS.BYTES_BUDGET });
        bytesBudgetRefusals += 1;
        return { status: 'unavailable', reason: SNAPSHOT_REASONS.BYTES_BUDGET };
      }

      documents.set(key, { ok: true, text, bytes });
      retainedBytes += bytes;
      return { status: 'ok', text };
    },

    stats() {
      return {
        readsAttempted,
        statsAttempted,
        // ⚠ NOT `uniqueDocuments`. Count-ceiling refusals are deliberately not retained, so after
        // exhaustion there is no key set to deduplicate against and no uniqueness can be claimed
        // over that population. This names the slots actually held.
        cachedDocuments: documents.size,
        cacheHits,
        retainedBytes,
        countBudgetRefusals,
        bytesBudgetRefusals,
        configured: { maxDocuments, maxRetainedBytes },
      };
    },
  };
}
