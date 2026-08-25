import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_EVIDENCE_CONTRACT_VERSIONS,
  DEFAULT_EVIDENCE_CONTRACT_VERSION,
  negotiateEvidenceContract,
  applyEvidenceContract,
  CONTRACT_BEHAVIOURS,
} from '../../../mcp/stdio/query/evidence-contract-negotiation.js';
import { DEPRECATED_EVIDENCE_FIELDS } from '../../../mcp/stdio/query/evidence-contract.js';

// Step 7.5. Step 8 (deleting `degraded` and `operationallyDegraded`) is HELD, because the
// fail-closed guard the deletion rests on has ZERO production callers: measured 0, against a
// positive control of 4 live sites for the producer stamp. A guard no reader invokes cannot
// protect an old reader from `!undefined === true`.
//
// ⛔ AND WIRING AN INTERNAL CALLER IS NOT THE FIX. That was my proposal and it was refused in
// review:
//
//     "A producer-side adapter that stamps v2 and immediately calls its own v2 guard proves only
//      self-consistency. It does not make an old external reader inspect the version."
//
// It would have produced a non-zero call count — the exact metric I was reaching for — and no
// protection at all. A CALL COUNT IS NOT A CONSUMER, the same way a stamped field is not a
// protocol. The hazardous reader is outside the producer boundary.
//
// ⇒ So the consumer must PROVE it understands v2 before it is handed v2. That is what negotiation
// buys that a published document does not: it does not depend on anyone noticing a field appeared.

describe('negotiateEvidenceContract — the consumer proves it understands v2 before receiving v2', () => {
  it('an OMITTED request gets contract 1, because silence is not consent', () => {
    // The whole point. An old client that has never heard of this field must keep receiving the
    // contract it was built against, indefinitely.
    const r = negotiateEvidenceContract(undefined);
    expect(r.ok).toBe(true);
    expect(r.version).toBe(1);
    expect(r.version).toBe(DEFAULT_EVIDENCE_CONTRACT_VERSION);
  });

  it('an explicit 1 gets contract 1', () => {
    const r = negotiateEvidenceContract(1);
    expect(r.ok).toBe(true);
    expect(r.version).toBe(1);
  });

  it('⭐ an explicit 2 gets contract 2 — the only way to receive it', () => {
    const r = negotiateEvidenceContract(2);
    expect(r.ok).toBe(true);
    expect(r.version).toBe(2);
  });

  it('⛔ REFUSES 0, negatives, and MIN_SAFE_INTEGER — they name no contract', () => {
    for (const bad of [0, -1, Number.MIN_SAFE_INTEGER]) {
      const r = negotiateEvidenceContract(bad);
      expect(r.ok, `requested=${bad}`).toBe(false);
    }
  });

  it('⛔ REFUSES a FUTURE version rather than best-effort downgrading it', () => {
    // Silently handing back v2 to a client that asked for v3 is the fail-open shape: the client
    // believes it holds a contract nobody emitted.
    const r = negotiateEvidenceContract(3);
    expect(r.ok).toBe(false);
  });

  it('⛔ REFUSES malformed carriers — a string that looks like a number is not one', () => {
    for (const bad of ['2', 2.5, Number.NaN, null, {}, []]) {
      const r = negotiateEvidenceContract(bad);
      expect(r.ok, `requested=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('⭐ a refusal NAMES what is supported, or the client cannot act on it', () => {
    // A refusal that does not say what would have worked makes the caller guess, which is the
    // stand-in-for-a-fix shape this project keeps removing.
    const r = negotiateEvidenceContract(3);
    expect(r.ok).toBe(false);
    expect(r.supported).toEqual([...SUPPORTED_EVIDENCE_CONTRACT_VERSIONS]);
    expect(typeof r.error).toBe('string');
    expect(r.error).toMatch(/3/);
  });

  it('⭐ says NO more often than YES across the input space — not a rubber stamp', () => {
    const cases = [undefined, 1, 2, 0, -1, 3, '2', 2.5, Number.NaN, null, {}, []];
    const accepted = cases.filter((v) => negotiateEvidenceContract(v).ok);
    expect(accepted).toEqual([undefined, 1, 2]);
    expect(accepted.length).toBeLessThan(cases.length - accepted.length);
  });

  it('⛔ the supported list is DERIVED FROM THE CONTRACT TABLE, not spelled a second time', () => {
    // ⛔ THIS ASSERTION USED TO CLAIM DERIVATION AND ONLY CHECK MEMBERSHIP — `toContain(1)` and
    // `toContain(2)` pass just as happily against a hardcoded literal, which is the comment-says-
    // one-thing-assertion-pins-another shape I repaired in the version guard an hour earlier.
    // Deriving the expectation from the same table the code derives from would be circular, so
    // this asserts the RELATIONSHIP: every negotiable version has a behaviour, and every declared
    // behaviour is negotiable. Adding a contract to the table with no entry here cannot pass.
    expect(SUPPORTED_EVIDENCE_CONTRACT_VERSIONS)
      .toEqual(Object.keys(CONTRACT_BEHAVIOURS).map(Number).sort((a, b) => a - b));
    for (const v of SUPPORTED_EVIDENCE_CONTRACT_VERSIONS) {
      expect(negotiateEvidenceContract(v).ok, `version ${v} is declared but not negotiable`).toBe(true);
    }
    expect(Object.isFrozen(SUPPORTED_EVIDENCE_CONTRACT_VERSIONS)).toBe(true);
  });

  it('⭐ every declared contract differs from the others in a way something CONSUMES', () => {
    // A contract table entry that no code branches on is decoration — the unreachable-branch
    // defect one level up. Each declared behaviour must actually change the rendered payload.
    const rendered = SUPPORTED_EVIDENCE_CONTRACT_VERSIONS
      .map((v) => JSON.stringify(applyEvidenceContract({ degraded: true, cause: 'x' }, v)));
    expect(new Set(rendered).size, 'two contracts rendering identically means one is inert')
      .toBe(SUPPORTED_EVIDENCE_CONTRACT_VERSIONS.length);
  });
});

describe('applyEvidenceContract — what the two contracts actually differ by', () => {
  const raw = () => ({
    exhaustive: false,
    cause: 'index_population_unattested',
    degraded: true,
    operationallyDegraded: false,
    warnings: ['something'],
  });

  it('⭐ CONTROL 1 — contract 1 carries the deprecated booleans, unchanged', () => {
    const e = applyEvidenceContract(raw(), 1);
    expect(e.contractVersion).toBe(1);
    for (const field of Object.keys(DEPRECATED_EVIDENCE_FIELDS)) {
      expect(e, `contract 1 must still carry ${field}`).toHaveProperty(field);
    }
  });

  it('⭐ CONTROL 2 — contract 2 carries NEITHER boolean', () => {
    const e = applyEvidenceContract(raw(), 2);
    expect(e.contractVersion).toBe(2);
    for (const field of Object.keys(DEPRECATED_EVIDENCE_FIELDS)) {
      expect(e, `contract 2 must not carry ${field}`).not.toHaveProperty(field);
    }
  });

  it('⭐ the fields that GOVERN ACTION survive both contracts identically', () => {
    // The removal must take away only the non-discriminating booleans. If `exhaustive` or `cause`
    // changed across contracts, the negotiation would be a behaviour change rather than a field
    // removal, and every absence decision would depend on which contract you asked for.
    const one = applyEvidenceContract(raw(), 1);
    const two = applyEvidenceContract(raw(), 2);
    expect(two.exhaustive).toBe(one.exhaustive);
    expect(two.cause).toBe(one.cause);
    expect(two.warnings).toEqual(one.warnings);
  });

  it('⛔ the response ECHOES the version, so a reader never infers it', () => {
    expect(applyEvidenceContract(raw(), 1).contractVersion).toBe(1);
    expect(applyEvidenceContract(raw(), 2).contractVersion).toBe(2);
  });

  it('⛔ REFUSES to apply an unnegotiated version rather than guessing', () => {
    // applyEvidenceContract is downstream of negotiation. If it silently accepted a bad version
    // it would be a second, weaker gate that lets callers bypass the first.
    for (const bad of [0, 3, undefined, '1']) {
      expect(() => applyEvidenceContract(raw(), bad), `version=${bad}`).toThrow();
    }
  });

  it('⛔ the deprecated-field list is the SAME one the contract declares', () => {
    // Two lists of "which fields are deprecated" is precisely how the two compile-DB allowlists
    // drifted apart. The stripper must read the declaration, not a copy of it.
    const e = applyEvidenceContract({ ...raw(), somethingElse: 1 }, 2);
    expect(e).toHaveProperty('somethingElse');   // it strips ONLY what is declared
    expect(Object.keys(DEPRECATED_EVIDENCE_FIELDS).length).toBeGreaterThan(0);
  });
});
