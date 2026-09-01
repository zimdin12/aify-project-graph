// ⛔ AN LSP LOCATION MUST BE INTERNALLY COHERENT BEFORE IT BECOMES A RECORD.
//
// Observed at the wire, on the real provider path, from clangd 22.1.6:
//
//   uri:   file:///C:/Program%20Files/.../MSVC/14.43.34604/include     <- a DIRECTORY
//   range: line 4, characters 5-16                                      <- exactly `alphaCaller`
//
// Sometimes as the only result, sometimes beside a correct sibling, and in BOTH
// textDocument/definition and textDocument/references responses. Boundary capture and the six
// falsified causes are in docs/evidence/m1a-step-c/; the cause is still open.
//
// ★ THE OBLIGATION IS OURS, NOT CLANGD'S. clangd is external and has already emitted this. What we
// control is whether it becomes a definition record that sends an agent to a path it cannot open.
// A record claiming a symbol is defined *in a directory* is not a lower-confidence answer — it is
// an answer no consumer can act on, and it would be indistinguishable from a real one downstream.
//
// ⚠ THE UNIT OF REFUSAL IS THE LOCATION, NEVER THE MESSAGE. A response mixing one good location
// with one incoherent one must keep the good one; discarding the message would turn a producer
// defect into lost evidence.
//
// ⚠ AND REFUSING IS NOT ENOUGH — IT MUST BE COUNTED. A filtered-to-zero result that reports
// success is indistinguishable from "this symbol genuinely has no definition", which is the exact
// absence-claim failure this project keeps rediscovering. Every refusal carries a typed reason and
// its exact rejected membership, bound to the method that produced it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const LOCATION_REFUSAL_REASONS = Object.freeze({
  UNKNOWN_SHAPE: 'unknown_shape',
  NOT_A_FILE_URI: 'not_a_file_uri',
  DIRECTORY_URI: 'directory_uri',
  INVALID_RANGE: 'invalid_range',
});

// Accept `Location {uri,range}` and `LocationLink {targetUri,targetRange|targetSelectionRange}`.
// URI and range are read from the SAME shape — never a URI from one object paired with a range
// from another, which is the assembly error the coherence contract exists to catch.
function readShape(location) {
  if (!location || typeof location !== 'object') return null;
  if (typeof location.uri === 'string') {
    return { uri: location.uri, range: location.range, shape: 'Location' };
  }
  if (typeof location.targetUri === 'string') {
    return {
      uri: location.targetUri,
      range: location.targetSelectionRange ?? location.targetRange,
      shape: 'LocationLink',
    };
  }
  return null;
}

function isWellFormedRange(range) {
  if (!range || typeof range !== 'object') return false;
  const { start, end } = range;
  for (const p of [start, end]) {
    if (!p || typeof p !== 'object') return false;
    if (!Number.isInteger(p.line) || p.line < 0) return false;
    if (!Number.isInteger(p.character) || p.character < 0) return false;
  }
  if (end.line < start.line) return false;
  if (end.line === start.line && end.character < start.character) return false;
  return true;
}

// ⚠ DIRECTORY-NESS IS DECIDED BY THE FILESYSTEM, NOT BY THE PATH'S SHAPE.
//
// A file-extension heuristic would reject `.../include/vector` — a real C++ standard header with
// no extension, and a legitimate definition site. The positive control in the replay test exists
// precisely to keep that shortcut out.
//
// When the target cannot be stat'd we do NOT refuse. "Unreadable" is a different defect from
// "incoherent", and inventing a refusal for a path this host simply lacks would manufacture
// absence — the failure mode this guard is meant to prevent, pointed the other way.
function classifyTarget(uri) {
  let filePath;
  try { filePath = fileURLToPath(uri); } catch { return { kind: 'not_a_file_uri' }; }
  try {
    return fs.statSync(filePath).isDirectory()
      ? { kind: 'directory', filePath }
      : { kind: 'file', filePath };
  } catch {
    return { kind: 'unverifiable', filePath };
  }
}

/**
 * Decide whether one LSP location may become a record.
 * @returns {{admitted:true, uri:string, range:object}|{admitted:false, reason:string, uri:string|null}}
 */
export function admitLocation(location) {
  const shape = readShape(location);
  if (!shape) {
    return { admitted: false, reason: LOCATION_REFUSAL_REASONS.UNKNOWN_SHAPE, uri: null };
  }
  if (!isWellFormedRange(shape.range)) {
    return { admitted: false, reason: LOCATION_REFUSAL_REASONS.INVALID_RANGE, uri: shape.uri };
  }
  const target = classifyTarget(shape.uri);
  if (target.kind === 'not_a_file_uri') {
    return { admitted: false, reason: LOCATION_REFUSAL_REASONS.NOT_A_FILE_URI, uri: shape.uri };
  }
  if (target.kind === 'directory') {
    // The load-bearing case: a directory cannot contain a character-precise identifier span.
    return { admitted: false, reason: LOCATION_REFUSAL_REASONS.DIRECTORY_URI, uri: shape.uri };
  }
  return { admitted: true, uri: shape.uri, range: shape.range };
}

/**
 * Partition a response's locations, preserving valid siblings and recording exact rejected
 * membership so a filtered-to-zero result can never present itself as a clean absence.
 */
export function admitLocations(locations, { method } = {}) {
  const list = Array.isArray(locations) ? locations : (locations ? [locations] : []);
  const admitted = [];
  const refused = [];
  for (const location of list) {
    const verdict = admitLocation(location);
    if (verdict.admitted) admitted.push(location);
    else refused.push({ method: method ?? null, reason: verdict.reason, uri: verdict.uri });
  }
  return { admitted, refused, examined: list.length };
}
