// What every code-intel collector stamps on its records: a collection id, and LSP ranges converted to the graph's
// 1-based lines and columns. One definition each (#19); they were copied into the runner, both providers and two
// live verbs, and the copies disagreed on a missing range.
import crypto from 'node:crypto';

export function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

// A missing range is null, not a throw. Locations are refused for an invalid range before they get here
// (location-coherence.js); what can arrive without one is a symbol, hover or diagnostic, and a record with
// `range: null` is still a record. cpp-clangd.js's copy dereferenced it and threw inside the collection loop.
export function rangeFromLsp(range) {
  if (!range) return null;
  return {
    start: { line: range.start.line + 1, col: range.start.character + 1 },
    end: { line: range.end.line + 1, col: range.end.character + 1 },
  };
}
