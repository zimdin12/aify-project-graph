import { buildEvidenceBlock, renderEvidenceBlock } from './packet-evidence.js';
import { getChangedFilesSync } from '../../freshness/git.js';

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function computeStale(block) {
  if (!block?.collectedAt) return false;
  const age = Date.now() - new Date(block.collectedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}

// Synchronous git-diff so verify mode stays sync. Used when caller passes
// `since:<ref>` without explicit `files[]`. Shares freshness/git.js's
// helper so verify and freshness derive changed files identically
// (including backslash→slash normalization on Windows). Returns [] on any
// git failure — verify still produces a useful packet with empty files.
function deriveFilesFromSinceSync(repoRoot, since) {
  // ⚠ `?? []` IS THE DEGRADATION THIS PATH ALREADY PROMISED, now written down rather than inherited.
  // getChangedFilesSync returns null when the diff could not be computed; for verify that is still
  // "produce a useful packet with empty files". The orchestrator makes the opposite choice from the
  // same signal, which is exactly why the signal had to stop being `[]` for both.
  return getChangedFilesSync(repoRoot, since, 'HEAD') ?? [];
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
    } else if (packet.analysis.status === 'partial') {
      const mode = packet.analysis.mode || 'unknown';
      const files = Array.isArray(packet.analysis.files) ? packet.analysis.files : [];
      const notCollected = packet.analysis.summary?.notCollected ?? files.filter(f => f.status !== 'ok').length;
      const reasons = files
        .filter(f => f.status !== 'ok')
        .map(f => f.reason || f.status || 'not_collected');
      const primaryReason = reasons[0] || 'not_collected';
      lines.push(`ANALYZER (${mode}): partial — ${notCollected} files not_collected (${primaryReason})`);
      for (const item of summarizeNotCollected(files)) {
        if (item.more) {
          lines.push(`  (+${item.more} more ${item.reason})`);
        } else {
          lines.push(`  not_collected ${item.file} [${item.reason}]`);
        }
      }
      for (const d of (packet.analysis.diagnostics || []).slice(0, 10)) {
        lines.push(`  ${d.severity || 'info'} ${d.file}:${d.line ?? '?'}:${d.col ?? '?'} [${d.provenance || 'ANALYZER'}] ${d.message || ''}`);
      }
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

function summarizeNotCollected(files, cap = 5) {
  const groups = new Map();
  for (const f of files) {
    if (f.status === 'ok') continue;
    const reason = f.reason || f.status || 'not_collected';
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(f.file || '<unknown>');
  }

  const out = [];
  for (const [reason, groupFiles] of groups) {
    for (const file of groupFiles.slice(0, cap)) {
      out.push({ reason, file });
    }
    if (groupFiles.length > cap) {
      out.push({ reason, more: groupFiles.length - cap });
    }
  }
  return out;
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
