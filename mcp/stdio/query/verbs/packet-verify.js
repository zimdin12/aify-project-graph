import { buildEvidenceBlock, renderEvidenceBlock } from './packet-evidence.js';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function computeStale(block) {
  if (!block?.collectedAt) return false;
  const age = Date.now() - new Date(block.collectedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

function renderVerify(packet) {
  const lines = [];
  lines.push('MODE: verify');
  lines.push(`FILES: ${packet.files.join(', ')}`);
  if (packet.since) lines.push(`SINCE: ${packet.since}`);

  if (!packet.evidence.available) {
    lines.push(renderEvidenceBlock(packet.evidence));
    lines.push('TRUST: tree-sitter+overlay only');
  } else {
    if (packet.partial) {
      const refsOp = packet.evidence.operations?.references;
      const ncCount = refsOp?.notCollectedFiles?.length || 0;
      const diagOk = packet.evidence.operations?.diagnostics?.status === 'ok';
      lines.push(`CODE_INTEL partial: ${diagOk ? 'diagnostics collected' : 'diagnostics partial'}, references not_collected for ${ncCount} files`);
      lines.push(renderEvidenceBlock(packet.evidence));
    } else {
      lines.push(renderEvidenceBlock(packet.evidence));
    }
    if (packet.stale) lines.push('FRESHNESS: STALE — code_intel collection older than threshold; consider re-running `apg code-intel collect`');
  }

  if (packet.diagnostics.length > 0) {
    lines.push(`DIAGNOSTICS (${packet.diagnostics.length}):`);
    for (const d of packet.diagnostics.slice(0, 10)) {
      const raw = d.raw || {};
      lines.push(`  ${raw.severity || 'info'} ${d.file}:${raw.range?.start?.line ?? '?'}: ${raw.message || ''}`);
    }
  }

  if (packet.sourceRequired) {
    lines.push('SOURCE_REQUIRED: this change touches audited code; confirm against source even with code_intel evidence');
  }
  return lines.join('\n');
}

export function buildVerifyPacket({ repoRoot, since = null, files = [], audited = false } = {}) {
  const evidence = buildEvidenceBlock({ repoRoot, files });
  const partial = evidence.available && evidence.status === 'partial';
  const stale = evidence.available && computeStale(evidence);
  const diagnostics = (evidence.diagnostics || []).filter(d => files.includes(d.file));
  const packet = {
    mode: 'verify',
    files: [...files],
    since,
    evidence,
    diagnostics,
    partial,
    stale,
    sourceRequired: !!audited
  };
  packet.rendered = renderVerify(packet);
  return packet;
}
