// D1's HERMETIC FIXTURE — handle ownership as a CAPABILITY, never an inference.
//
// ⛔ WHY THE OLD FIXTURE CANNOT CARRY D1. A wrapper cannot honestly know that an arbitrary
// `.close()` came from production merely because harness cleanup is not currently running. A
// mutable phase flag, or stack inspection, would be the fixture GUESSING at attribution — and a
// fixture that guesses ownership manufactures exactly the appearance this arm exists to measure.
//
// ⇒ Production and the harness receive DIFFERENT CAPABILITIES:
//
//     holder      | what it receives                          | recorded on close
//     production  | the wrapped handle from the mocked opener  | closedBy: 'production'
//     harness     | an out-of-band raw closure, NEVER reachable| closedBy: 'harness'
//                 | through the wrapper                        |
//
// The raw closure lives in this inventory and is not a property of the object production holds, so
// production has no path to it. Attribution is therefore structural: you cannot record
// `closedBy: 'production'` without holding the production capability, because that is the only
// object that carries the method which writes it.
//
// ⚠ THIS FILE AUTHORS NO D1 PREDICATE. The executor and the current referee have both seen the old
// answer; a THIRD BLIND REFEREE must derive a predicate from the guarantee and from this source.
// Nothing here re-runs D1 under the old preregistration — `27a1b0c` stands, and any future attempt
// is a new carrier with a new preregistration citing the failed one, never presented as redemption.
import { randomUUID } from 'node:crypto';

export const CLOSED_BY = Object.freeze({
  PRODUCTION: 'production',
  HARNESS: 'harness',
});

/** Raised when attribution would have to be overwritten or invented. */
export class AttributionError extends Error {
  constructor(message) { super(message); this.name = 'AttributionError'; }
}

/**
 * Per-invocation identity.
 *
 * ⛔ ITS OWN CONTROL COMES FIRST. Two invocations must yield two DISTINCT tokens, and that is
 * asserted before any equality on tokens is used as evidence — otherwise "two starts observed"
 * could be produced by a factory that returns a constant, and the arm would be measuring the
 * factory rather than the server.
 */
export const newRunToken = () => randomUUID();

export class HandleInventory {
  constructor() {
    /** @type {Map<string, {id, token, kind, closedBy: string|null, rawClose: Function, closedAt: string|null}>} */
    this._handles = new Map();
    this._sealed = false;
  }

  /**
   * Register a resource the scenario opened.
   *
   * @param kind      what was opened ('server' | 'db' | ...), for the leak report
   * @param rawClose  the REAL closure. Held here and nowhere else.
   * @returns the object PRODUCTION receives — it carries `close()` and nothing else.
   */
  open({ kind, token, rawClose }) {
    if (this._sealed) throw new AttributionError('inventory is sealed; nothing may be opened after the first snapshot');
    if (typeof rawClose !== 'function') throw new AttributionError(`open(${kind}) requires a real rawClose`);
    const id = randomUUID();
    const record = { id, kind, token, closedBy: null, closedAt: null, rawClose };
    this._handles.set(id, record);

    // ⚠ The production capability. It closes, and it can ONLY record 'production'. There is no
    // parameter to override the attribution, because a parameter is a path.
    return Object.freeze({
      id,
      kind,
      token,
      close: () => this._close(id, CLOSED_BY.PRODUCTION),
    });
  }

  _close(id, by) {
    const r = this._handles.get(id);
    if (!r) throw new AttributionError(`close of unknown handle ${id}`);
    if (r.closedBy !== null) {
      // ⛔ DOUBLE CLOSE AND CONFLICTING ATTRIBUTION RAISE LOUDLY. Silently overwriting would let a
      // harness cleanup relabel a handle production never released — which is precisely the false
      // appearance D1 exists to detect.
      throw new AttributionError(
        `handle ${id} (${r.kind}) already closedBy=${r.closedBy}; refusing a second close by ${by}. `
        + 'Overwriting attribution would manufacture the ownership this fixture measures.',
      );
    }
    r.closedBy = by;
    r.closedAt = new Date().toISOString();
    r.rawClose();
    return r;
  }

  /**
   * The harness capability — out of band, never reachable through the wrapper.
   * Used only at step 5, after the ownership snapshot is frozen.
   */
  harnessClose(id) { return this._close(id, CLOSED_BY.HARNESS); }

  /** Ids still open, for step 5 and for the leak report. */
  stillOpenIds() {
    return [...this._handles.values()].filter((r) => r.closedBy === null).map((r) => r.id);
  }

  /**
   * An IMMUTABLE record of the world at this instant.
   *
   * ⛔ FROZEN, because step 5 must not be able to rewrite what step 4 observed. The whole ordering
   * (snapshot → release → snapshot → clean → assert) exists so that harness cleanup cannot edit the
   * evidence it comes after.
   */
  snapshot(label) {
    this._sealed = true;
    const rows = [...this._handles.values()].map((r) => Object.freeze({
      id: r.id, kind: r.kind, token: r.token, closedBy: r.closedBy, closedAt: r.closedAt,
    }));
    return Object.freeze({
      label,
      at: new Date().toISOString(),
      opened: rows.length,
      productionClosed: rows.filter((r) => r.closedBy === CLOSED_BY.PRODUCTION).length,
      harnessClosed: rows.filter((r) => r.closedBy === CLOSED_BY.HARNESS).length,
      stillOpen: rows.filter((r) => r.closedBy === null).length,
      // ⚠ The leak is NAMED, not counted. "production owns fewer handles than were opened" is not
      // actionable; the specific unowned ids are.
      unownedIds: Object.freeze(rows.filter((r) => r.closedBy === null).map((r) => r.id)),
      distinctTokens: Object.freeze([...new Set(rows.map((r) => r.token))]),
      rows: Object.freeze(rows),
    });
  }
}

/**
 * PORTABLE AUTHORITY IS THE ACCOUNTING, NOT `EBUSY`.
 *
 * ⛔ Filesystem removal is a final cleanup CHECK whose result is recorded — it is not the witness.
 * `EBUSY` is a Windows artefact; on POSIX an open file unlinks happily, so a fixture that treated
 * removal failure as the signal would measure the platform rather than the leak.
 *
 * ⇒ The authority is opened / production-closed / harness-closed / still-open, which is the same
 * on every platform.
 */
export function cleanupResult(fn) {
  try { fn(); return Object.freeze({ removed: true, error: null }); }
  catch (e) { return Object.freeze({ removed: false, error: `${e.code ?? ''} ${e.message}`.trim().slice(0, 200) }); }
}
