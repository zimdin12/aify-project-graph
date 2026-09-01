// The frozen contract, asserted directly against the admission decision.
//
// Contract: docs/evidence/m1a-step-c/CONTRACT-lsp-location.md, frozen BEFORE the corrupt wire
// payload was observed. The replay test drives the same guard through a fake clangd process; this
// file exercises the predicate itself, so each frozen predicate has a control that names it.
//
// ⛔ THREE OUTCOMES, NEVER TWO. The first version of this guard had two, and folded "could not
// check" into "admitted" — which is how lack of verification becomes authority. An explained zero
// does not manufacture absence; an unverified admission manufactures a definition site nobody
// checked, indistinguishable downstream from a verified one.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitLocation, admitLocations, ADMISSION, LOCATION_REASONS } from '../../../mcp/stdio/code-intel/location-coherence.js';

let dir;
let fileUri;
let dirUri;
const TOKEN = 'alphaCaller';
// line 0: 'void alphaCaller() {'  -> characters 5..16 are exactly `alphaCaller`
const RANGE = { start: { line: 0, character: 5 }, end: { line: 0, character: 16 } };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'apg-coherence-'));
  writeFileSync(join(dir, 'real.cpp'), 'void alphaCaller() {\n  return;\n}\n', 'utf8');
  fileUri = pathToFileURL(join(dir, 'real.cpp')).toString();
  dirUri = pathToFileURL(dir).toString();
});
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows handle */ } });

describe('location coherence — the frozen contract, predicate by predicate', () => {
  it('POSITIVE CONTROL: a real readable file with a matching token is ADMITTED', () => {
    // Without this the guard could refuse everything and every negative test below would pass.
    const v = admitLocation({ uri: fileUri, range: RANGE }, { expectedToken: TOKEN });
    expect(v.outcome).toBe(ADMISSION.ADMITTED);
  });

  it('a DIRECTORY uri with an identifier range is REFUSED_INVALID', () => {
    const v = admitLocation({ uri: dirUri, range: RANGE }, { expectedToken: TOKEN });
    expect(v.outcome).toBe(ADMISSION.REFUSED_INVALID);
    expect(v.reason).toBe(LOCATION_REASONS.DIRECTORY_URI);
  });

  it('a readable file with a range BEYOND EOF is REFUSED_INVALID', () => {
    const v = admitLocation(
      { uri: fileUri, range: { start: { line: 99, character: 0 }, end: { line: 99, character: 4 } } },
      { expectedToken: TOKEN },
    );
    expect(v.outcome).toBe(ADMISSION.REFUSED_INVALID);
    expect(v.reason).toBe(LOCATION_REASONS.RANGE_OUT_OF_BOUNDS);
  });

  it('a readable file with an IN-BOUNDS WRONG token is REFUSED_INVALID', () => {
    // Range covers `void`, not `alphaCaller`. Syntactically perfect, semantically wrong — the
    // case a bounds-only check would wave through.
    const v = admitLocation(
      { uri: fileUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } },
      { expectedToken: TOKEN },
    );
    expect(v.outcome).toBe(ADMISSION.REFUSED_INVALID);
    expect(v.reason).toBe(LOCATION_REASONS.TOKEN_MISMATCH);
  });

  it('⛔ a MISSING file is UNAVAILABLE_UNVERIFIED and is NOT admitted', () => {
    // The fail-open this guard shipped with once. It must be neither evidence nor absence.
    const missing = pathToFileURL(join(dir, 'does-not-exist.cpp')).toString();
    const v = admitLocation({ uri: missing, range: RANGE }, { expectedToken: TOKEN });
    expect(v.outcome).toBe(ADMISSION.UNAVAILABLE_UNVERIFIED);
    expect(v.reason).toBe(LOCATION_REASONS.FILE_STATUS_UNAVAILABLE);
    expect(v.outcome).not.toBe(ADMISSION.ADMITTED);
  });

  it('a token that is not a plain identifier is UNAVAILABLE_UNVERIFIED, not forced to a boolean', () => {
    // Operators, destructors, aliases and macro-origin sites are legitimate unknowns. Tuning a
    // regex until they returned true would be a silent weakening of the contract.
    for (const token of ['operator<<', '~Widget', '']) {
      const v = admitLocation({ uri: fileUri, range: RANGE }, { expectedToken: token });
      expect(v.outcome, `token ${JSON.stringify(token)}`).toBe(ADMISSION.UNAVAILABLE_UNVERIFIED);
      expect(v.reason).toBe(LOCATION_REASONS.TOKEN_UNVERIFIABLE);
    }
  });

  it('an unknown response shape is REFUSED_INVALID, never coerced into a Location', () => {
    for (const bad of [null, {}, { range: RANGE }, 'nope']) {
      const v = admitLocation(bad, { expectedToken: TOKEN });
      expect(v.outcome).toBe(ADMISSION.REFUSED_INVALID);
      expect(v.reason).toBe(LOCATION_REASONS.UNKNOWN_SHAPE);
    }
  });

  it('LocationLink is accepted, with uri and range read from the SAME shape', () => {
    const v = admitLocation({ targetUri: fileUri, targetSelectionRange: RANGE }, { expectedToken: TOKEN });
    expect(v.outcome).toBe(ADMISSION.ADMITTED);
  });

  it('a MIXED response keeps its valid sibling and excludes each invalid class independently', () => {
    const missing = pathToFileURL(join(dir, 'gone.cpp')).toString();
    const gate = admitLocations([
      { uri: fileUri, range: RANGE },                                                   // valid
      { uri: dirUri, range: RANGE },                                                    // directory
      { uri: fileUri, range: { start: { line: 99, character: 0 }, end: { line: 99, character: 1 } } }, // EOF
      { uri: fileUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } },   // wrong token
      { uri: missing, range: RANGE },                                                   // unreadable
    ], { method: 'textDocument/references', expectedToken: TOKEN });

    expect(gate.admitted).toHaveLength(1);
    expect(gate.admitted[0].uri).toBe(fileUri);
    expect(gate.refused.map((r) => r.reason).sort()).toEqual([
      LOCATION_REASONS.DIRECTORY_URI,
      LOCATION_REASONS.RANGE_OUT_OF_BOUNDS,
      LOCATION_REASONS.TOKEN_MISMATCH,
    ].sort());
    expect(gate.unavailable.map((r) => r.reason)).toEqual([LOCATION_REASONS.FILE_STATUS_UNAVAILABLE]);
    // membership is retained, not just counted
    for (const row of [...gate.refused, ...gate.unavailable]) {
      expect(row.method).toBe('textDocument/references');
      expect(typeof row.uri).toBe('string');
    }
    expect(gate.examined).toBe(5);
  });
});
