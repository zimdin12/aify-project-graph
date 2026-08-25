// Three-state result + provenance rendering helpers.
//
// Used by query verbs and (Plan #4) the v2 packet to format consistent
// EVIDENCE: lines so agents can distinguish "found", "not found after
// retry", and "not collected" — and tell which provenance any record came
// from at a glance.

export function formatProvenanceTag(record) {
  if (!record) return 'UNKNOWN';
  if (record.kind === 'overlay' || record.provenance === 'overlay') return 'OVERLAY';
  if (record.provenance === 'text-search' || record.confidence === 'low') return 'INFERRED';
  if (record.provenance === 'tree-sitter' || record.provenance === 'extract') return 'EXTRACTED';
  if (typeof record.provenance === 'string' && record.provenance.includes('@')) return 'CODE_INTEL';
  return 'EXTRACTED';
}

export function formatThreeStateRefs({ state, count = 0, providerStatus = 'ok', reason = '' }) {
  if (state === 'found') return `found (${count}, provider=${providerStatus})`;
  if (state === 'not_found_after_retry') return `not_found_after_retry (provider=${providerStatus})`;
  if (state === 'not_collected') return `not_collected${reason ? ` (${reason})` : ''}`;
  return `unknown (${state})`;
}

export function renderEvidenceLine(input) {
  if (!input || input.available === false) {
    const reason = input?.reason || 'provider_missing';
    return `EVIDENCE: tree-sitter+overlay only; code_intel unavailable (${reason}: install clangd or set --no-code-intel to silence)`;
  }
  const parts = [];
  parts.push(`provider=${input.provider}@${input.providerVersion}`);
  parts.push(`status=${input.status}`);
  if (input.operations) {
    // ⛔ `_session` — internal importer metadata (importer.js:968), not an operation — was
    // rendered as `_session=undefined` because it has no `status`. It shipped in every packet
    // on a C++ repo and survived two rounds of fixes before the field test re-raised it.
    // ⇒ Filter by SHAPE, not by name: a leading underscore marks internal state. A name list
    // would need editing the next time the importer adds a key, which is exactly the
    // enumeration failure this codebase keeps reproducing.
    const opSummary = Object.entries(input.operations)
      .filter(([op, info]) => !op.startsWith('_') && info && info.status !== undefined)
      .map(([op, info]) =>
      `${op}=${info.status}${info.count != null ? `(${info.count})` : ''}${info.notCollectedFiles?.length ? `[notCollected:${info.notCollectedFiles.length}]` : ''}`
    ).join(' ');
    parts.push(opSummary);
  }
  return `EVIDENCE: ${parts.join('; ')}`;
}
