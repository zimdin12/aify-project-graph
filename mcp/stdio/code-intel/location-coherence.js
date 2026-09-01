// ⛔ AN LSP LOCATION MUST BE POSITIVELY VERIFIED BEFORE IT BECOMES EVIDENCE.
//
// Observed at the wire, on the real provider path, from clangd 22.1.6:
//
//   uri:   file:///C:/Program%20Files/.../MSVC/14.43.34604/include     <- a DIRECTORY
//   range: line 4, characters 5-16                                      <- exactly `alphaCaller`
//
// In BOTH textDocument/definition and textDocument/references, sometimes as the only result and
// sometimes beside a correct sibling. Boundary capture and six falsified causes:
// docs/evidence/m1a-step-c/. The cause is still open and does not gate this guard.
//
// ★ THE OBLIGATION IS OURS, NOT CLANGD'S. What we control is whether an unusable location becomes
// a record that sends an agent to a path it cannot open.
//
// ⛔ AND THE FIRST VERSION OF THIS FILE WAS FAIL-OPEN, WITH THE EXCUSE WRITTEN INTO IT.
// It admitted any location it could not stat, arguing that refusing "would manufacture absence".
// That is backwards, and the wrong reasoning sitting in a comment is worse than a silent bug
// because the next reader is persuaded by it. An explained zero does NOT manufacture absence.
// Admitting unverified location evidence DOES manufacture authority — the record then claims a
// definition site nobody checked, and downstream it is indistinguishable from a verified one.
//
// Hence THREE outcomes, never two. "Not proven invalid" is not "valid".
import { fileURLToPath } from 'node:url';

export const ADMISSION = Object.freeze({
  ADMITTED: 'admitted',
  REFUSED_INVALID: 'refused_invalid',
  UNAVAILABLE_UNVERIFIED: 'unavailable_unverified',
});

export const LOCATION_REASONS = Object.freeze({
  // REFUSED_INVALID — positively proven incoherent.
  UNKNOWN_SHAPE: 'unknown_shape',
  NOT_A_FILE_URI: 'not_a_file_uri',
  DIRECTORY_URI: 'directory_uri',
  INVALID_RANGE_SYNTAX: 'invalid_range_syntax',
  RANGE_OUT_OF_BOUNDS: 'range_out_of_bounds',
  TOKEN_MISMATCH: 'token_mismatch',
  // UNAVAILABLE_UNVERIFIED — could not be checked. Not evidence, not absence.
  FILE_STATUS_UNAVAILABLE: 'file_status_unavailable',
  TOKEN_UNVERIFIABLE: 'token_unverifiable',
});

// Accept `Location {uri,range}` and `LocationLink {targetUri,targetRange|targetSelectionRange}`.
// URI and range come from the SAME shape — never a URI from one object paired with a range from
// another, which is the assembly error the frozen contract exists to catch.
function readShape(location) {
  if (!location || typeof location !== 'object') return null;
  if (typeof location.uri === 'string') return { uri: location.uri, range: location.range };
  if (typeof location.targetUri === 'string') {
    return { uri: location.targetUri, range: location.targetSelectionRange ?? location.targetRange };
  }
  return null;
}

function rangeSyntaxOk(range) {
  if (!range || typeof range !== 'object') return false;
  for (const p of [range.start, range.end]) {
    if (!p || typeof p !== 'object') return false;
    if (!Number.isInteger(p.line) || p.line < 0) return false;
    if (!Number.isInteger(p.character) || p.character < 0) return false;
  }
  if (range.end.line < range.start.line) return false;
  if (range.end.line === range.start.line && range.end.character < range.start.character) return false;
  return true;
}

// ⚠ ONE READ OF THE TARGET BYTES IS THE AUTHORITY. Not stat-then-assume: the same bytes that
// decide the file exists also decide whether the range is in bounds and what text it covers.
// A stat can succeed and the read still fail, and then a bounds check would be asserting against
// a file nobody opened.
//
// ⚠ DIRECTORY-NESS IS DECIDED BY THE FILESYSTEM, NOT PATH SHAPE. An extension heuristic would
// reject `.../include/vector` — a real standard header with no extension and a legitimate
// definition site. `stat` is consulted ONLY to classify a read failure (directory vs unreadable),
// never to stand in for the read.
function readTarget(uri, readDocument) {
  let filePath;
  try { filePath = fileURLToPath(uri); }
  catch { return { kind: 'not_a_file_uri' }; }
  const got = readDocument(filePath);
  if (got.status === 'ok') return { kind: 'file', filePath, text: got.text };
  if (got.reason === 'directory_uri') return { kind: 'directory', filePath };
  return { kind: 'unreadable', filePath, code: got.reason };
}

// ⚠ THE EXPECTED TOKEN COMES FROM THE REQUEST, NOT FROM THE RETURNED RANGE. Deriving it from the
// response would make the check self-confirming: whatever came back would identify itself.
//
// ⚠ AND IT IS NOT FORCED THROUGH A REGEX TO OBTAIN A BOOLEAN. Operators, destructors, aliases and
// macro-origin sites are legitimate cases where correspondence cannot be established from a plain
// identifier. Those are UNAVAILABLE_UNVERIFIED — an honest "not checked" — rather than a
// manufactured pass or a false mismatch.
const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function leafOf(name) {
  const parts = String(name ?? '').split('::');
  return (parts[parts.length - 1] ?? '').trim();
}

// ⚠ `readDocument` IS REQUIRED, not defaulted. It is the collection-owned document snapshot, and
// defaulting it to a direct read would restore one filesystem read per Location — the very defect
// the snapshot exists to remove — silently, in whichever caller forgot to pass it. A caller that
// forgets now fails loudly instead.
export function admitLocation(location, { expectedToken, readDocument } = {}) {
  if (typeof readDocument !== 'function') {
    throw new TypeError('admitLocation requires a readDocument (the collection-owned document snapshot)');
  }
  const shape = readShape(location);
  if (!shape) {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.UNKNOWN_SHAPE, uri: null };
  }
  if (!rangeSyntaxOk(shape.range)) {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.INVALID_RANGE_SYNTAX, uri: shape.uri };
  }

  const target = readTarget(shape.uri, readDocument);
  if (target.kind === 'not_a_file_uri') {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.NOT_A_FILE_URI, uri: shape.uri };
  }
  if (target.kind === 'directory') {
    // The load-bearing case: a directory cannot contain a character-precise identifier span.
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.DIRECTORY_URI, uri: shape.uri };
  }
  if (target.kind === 'unreadable') {
    return {
      outcome: ADMISSION.UNAVAILABLE_UNVERIFIED,
      reason: LOCATION_REASONS.FILE_STATUS_UNAVAILABLE,
      uri: shape.uri,
      detail: target.code,
    };
  }

  // Bounds are checked against the bytes just read, not against a second read or a stat.
  const lines = target.text.split(/\r?\n/u);
  const { start, end } = shape.range;
  if (start.line >= lines.length || end.line >= lines.length) {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.RANGE_OUT_OF_BOUNDS, uri: shape.uri };
  }
  if (start.character > lines[start.line].length || end.character > lines[end.line].length) {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.RANGE_OUT_OF_BOUNDS, uri: shape.uri };
  }

  const leaf = leafOf(expectedToken);
  if (!leaf || !PLAIN_IDENTIFIER.test(leaf)) {
    return { outcome: ADMISSION.UNAVAILABLE_UNVERIFIED, reason: LOCATION_REASONS.TOKEN_UNVERIFIABLE, uri: shape.uri };
  }
  const covered = start.line === end.line
    ? lines[start.line].slice(start.character, end.character)
    : lines[start.line].slice(start.character);
  if (!covered.includes(leaf)) {
    return { outcome: ADMISSION.REFUSED_INVALID, reason: LOCATION_REASONS.TOKEN_MISMATCH, uri: shape.uri };
  }

  return { outcome: ADMISSION.ADMITTED, uri: shape.uri, range: shape.range };
}

/**
 * Partition a response's locations. Valid siblings survive; every non-admitted location keeps its
 * exact reason and membership, bound to the method that produced it, so a filtered-to-zero result
 * can never present itself as a clean absence.
 */
export function admitLocations(locations, { method, expectedToken, readDocument } = {}) {
  const list = Array.isArray(locations) ? locations : (locations ? [locations] : []);
  // ⚠ `locationValidationRequests` counts every Location OFFERED to the validator. It is a LARGER
  // population than the snapshot's accesses: a Location refused on shape, on range syntax, or on
  // an unparseable URI never reaches a snapshot lookup at all. Reporting one against the other's
  // denominator is the wrong-noun error this arc keeps producing.
  const locationValidationRequests = list.length;
  const admitted = [];
  const refused = [];
  const unavailable = [];
  for (const location of list) {
    const verdict = admitLocation(location, { expectedToken, readDocument });
    const row = { method: method ?? null, reason: verdict.reason, uri: verdict.uri, ...(verdict.detail ? { detail: verdict.detail } : {}) };
    if (verdict.outcome === ADMISSION.ADMITTED) admitted.push(location);
    else if (verdict.outcome === ADMISSION.REFUSED_INVALID) refused.push(row);
    else unavailable.push(row);
  }
  return { admitted, refused, unavailable, locationValidationRequests, examined: list.length };
}
