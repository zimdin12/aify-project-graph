import { execFileSync } from 'node:child_process';
import { buildEvidenceBlock, renderEvidenceBlock } from './packet-evidence.js';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function computeStale(block) {
  if (!block?.collectedAt) return false;
  const age = Date.now() - new Date(block.collectedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

// Synchronous git-diff so verify mode stays sync. Used when caller passes
// `since:<ref>` without explicit `files[]`. Returns [] on any git failure
// (no git, no commits, invalid ref, not a repo) — verify still produces a
// useful packet with explicit empty files list.
function deriveFilesFromSinceSync(repoRoot, since) {
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${since}..HEAD`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out || '').split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
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

  if (packet.analysis) {
    if (packet.analysis.status === 'error') {
      const err = packet.analysis.errors?.[0];
      lines.push(`ANALYZER: error ${err?.code || 'unknown'} — ${err?.hint || err?.message || 'see tool output'}`);
    } else {
      lines.push(`ANALYZER (${packet.analysis.mode || 'unknown'}): ${packet.analysis.summary?.diagnostics ?? 0} diagnostics, ${packet.analysis.summary?.errors ?? 0} errors, ${packet.analysis.summary?.warnings ?? 0} warnings`);
      for (const d of (packet.analysis.diagnostics || []).slice(0, 10)) {
        lines.push(`  ${d.severity || 'info'} ${d.file}:${d.line ?? '?'}:${d.col ?? '?'} [${d.provenance || 'ANALYZER'}] ${d.message || ''}`);
      }
    }
  }

  if (packet.sourceRequired) {
    lines.push('SOURCE_REQUIRED: this change touches audited code; confirm against source even with code_intel evidence');
  }
  return lines.join('\n');
}

export function buildVerifyPacket({ repoRoot, since = null, files = [], audited = false, analysis = null } = {}) {
  const resolvedFiles = (Array.isArray(files) && files.length > 0)
    ? files
    : (since ? deriveFilesFromSinceSync(repoRoot, since) : []);
  const evidence = buildEvidenceBlock({ repoRoot, files: resolvedFiles });
  const partial = evidence.available && evidence.status === 'partial';
  const stale = evidence.available && computeStale(evidence);
  const diagnostics = (evidence.diagnostics || []).filter(d => resolvedFiles.includes(d.file));
  const packet = {
    mode: 'verify',
    files: [...resolvedFiles],
    since,
    evidence,
    diagnostics,
    analysis,
    partial,
    stale,
    sourceRequired: !!audited,
    filesDerivedFromSince: resolvedFiles !== files && since ? true : false
  };
  packet.rendered = renderVerify(packet);
  return packet;
}
