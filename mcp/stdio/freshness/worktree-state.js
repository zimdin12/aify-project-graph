// THE WORKING TREE AS OBSERVED — OR THE EXPLICIT FACT THAT IT COULD NOT BE OBSERVED.
//
// ⛔ THE DEFECT THIS EXISTS TO MAKE UNWRITABLE. Seven call sites each ran their own git query and
// each wrote its own `.catch(() => [])`. A failed `git status` therefore produced an empty entry
// list, which is BYTE-FOR-BYTE the shape of a clean tree — so the tracked-modification warning,
// whose own comment calls it "the only thing standing between a user and a stale answer", was
// silenced by exactly the condition it exists to report.
//
// ⛔⛔ AND THE SHARPER HALF: `getHeadCommit` was ALREADY honest. It returns null on failure, which is
// correct. The consumers threw that honesty away — `Boolean(manifest.commit && head && ...)` turns
// an unknown HEAD into `stale = false`, and graph_search then printed "Ruled out: the index is
// fresh" as a reason a symbol was not found. An honest producer buys nothing if its consumer
// launders the unknown into a claim.
//
// ⇒ So the unknown is given a home rather than a convention. There is one place that runs the
// queries, one place that knows which of them failed, and one place that writes the disclosure. A
// caller cannot reconstruct "empty" from "unavailable" because this object never hands out an empty
// array it did not observe.
import { getDirtyFileEntries, getHeadCommit } from './git.js';

// ⚠ The two queries fail INDEPENDENTLY. `git rev-parse HEAD` fails on an unborn branch while
// `git status` succeeds; an index.lock can break status while rev-parse still answers. Collapsing
// them into one "git is broken" flag would report a condition neither query established.
export class WorktreeState {
  constructor({ head = null, headError = null, entries = null, entriesError = null } = {}) {
    this.head = head;
    this.headError = headError;
    this.entries = entries;
    this.entriesError = entriesError;
    Object.freeze(this);
  }

  // The only constructor that touches git. Both queries are attempted even if the first fails,
  // because "we could not read HEAD" is not a reason to stop knowing the dirty state.
  static async observe(repoRoot) {
    const [head, entries] = await Promise.all([
      getHeadCommit(repoRoot).then((h) => ({ ok: true, value: h }), (e) => ({ ok: false, error: e })),
      getDirtyFileEntries(repoRoot).then((v) => ({ ok: true, value: v }), (e) => ({ ok: false, error: e })),
    ]);
    return new WorktreeState({
      head: head.ok ? head.value : null,
      headError: head.ok ? null : shortReason(head.error),
      entries: entries.ok ? entries.value : null,
      entriesError: entries.ok ? null : shortReason(entries.error),
    });
  }

  get headKnown() { return this.headError === null; }

  get dirtyKnown() { return this.entriesError === null && this.entries !== null; }

  // ⛔ null, NOT []. An empty array is a measurement; null is the absence of one. A caller that
  // spreads or `.length`s this without deciding what to do about an unknown gets a TypeError at the
  // seam rather than a confident zero three screens later.
  get trackedDirty() {
    return this.dirtyKnown ? this.entries.filter((e) => !e.untracked).map((e) => e.path) : null;
  }

  get allDirty() {
    return this.dirtyKnown ? this.entries.map((e) => e.path) : null;
  }

  get untrackedCount() {
    if (!this.dirtyKnown) return null;
    return this.entries.length - this.trackedDirty.length;
  }

  /**
   * TRI-STATE, and the third state is the whole point.
   *
   *   true   the indexed commit differs from HEAD
   *   false  they match — MEASURED, not assumed
   *   null   HEAD or the indexed commit is unknown, so staleness was never determined
   *
   * ⛔ A caller must not write `!staleness(...)` and call the result fresh. `!null` is `true`, which
   * is how "Ruled out: the index is fresh" got printed for a git query that never ran. Test
   * `=== false` when the claim is that the index IS current.
   */
  stalenessAgainst(indexedCommit) {
    if (!indexedCommit || !this.headKnown) return null;
    return indexedCommit !== this.head;
  }

  /**
   * What the reader must be told, and NOTHING otherwise.
   *
   * ⛔ THE OVER-CORRECTION GUARD, and the constraint that decides this whole design. These lines
   * print on every read verb in the product. A caveat emitted on the ordinary healthy path would be
   * permanent noise on every answer, and would train readers to skip the block that carries the
   * warning that matters. Returns [] when both queries succeeded — that emptiness is a measurement
   * and is asserted by a control.
   */
  disclosures() {
    const out = [];
    if (!this.headKnown) {
      out.push(
        `could not read HEAD (${this.headError}) — staleness was NOT determined for this answer; `
        + 'the absence of a staleness warning below is not evidence the snapshot is current.',
      );
    }
    if (!this.dirtyKnown) {
      out.push(
        `could not read the working tree (${this.entriesError}) — modified tracked files were NOT `
        + 'counted; the absence of a dirty-tree warning below is not evidence the tree is clean.',
      );
    }
    return out;
  }
}

// git's own message carries the useful part ("not a git repository", "index.lock"); the wrapper
// prefix and the stack do not. Bounded, because this lands in a warning line a human reads.
function shortReason(error) {
  const raw = String(error?.stderr || error?.message || error || 'unknown error');
  const line = raw.split(/\r?\n/u).map((l) => l.trim()).filter(Boolean)[0] ?? 'unknown error';
  return line.replace(/^Command failed:\s*/u, '').slice(0, 120);
}
