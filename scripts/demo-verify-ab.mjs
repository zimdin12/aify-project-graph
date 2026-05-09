#!/usr/bin/env node
// A/B demo: compare baseline (no code-intel) vs verify-mode (with code-intel)
// on a fixture repo. Demonstrates the user-visible payoff from the superplan
// thesis: packet IS the LSP for agents, with provenance and three-state
// rendering folded in.
//
// Usage: node scripts/demo-verify-ab.mjs [--json]

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { graphPacket } from '../mcp/stdio/query/verbs/packet.js';
import { graphHealth } from '../mcp/stdio/query/verbs/health.js';
import { openDb, openExistingDb } from '../mcp/stdio/storage/db.js';
import { importCodeIntel } from '../mcp/stdio/ingest/code-intel/importer.js';

function setupRepoBaseline() {
  const dir = mkdtempSync(join(tmpdir(), 'apg-ab-baseline-'));
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });
  const db = openDb(join(dir, '.aify-graph', 'graph.sqlite')); db.close();
  return dir;
}

function setupRepoWithCodeIntel(fixtureFile) {
  const dir = mkdtempSync(join(tmpdir(), 'apg-ab-codeintel-'));
  mkdirSync(join(dir, '.aify-graph'), { recursive: true });
  const dbPath = join(dir, '.aify-graph', 'graph.sqlite');
  const db = openDb(dbPath); db.close();
  const tmpFix = join(tmpdir(), `apg-ab-fix-${Date.now()}.json`);
  writeFileSync(tmpFix, readFileSync(fixtureFile, 'utf8'));
  const db2 = openExistingDb(dbPath, { readonly: false });
  importCodeIntel(tmpFix, db2);
  db2.close();
  return dir;
}

function tokenEstimate(s) { return Math.ceil((s || '').length / 4); }

function countSignals(text, signal) {
  if (!text) return 0;
  const re = new RegExp(signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  const matches = text.match(re);
  return matches ? matches.length : 0;
}

async function run(jsonMode) {
  const fixturePath = 'tests/fixtures/code-intel/v02/cpp-bar-diagnostic-collection.json';
  const baselineDir = setupRepoBaseline();
  const codeIntelDir = setupRepoWithCodeIntel(fixturePath);

  const baselineHealth = await graphHealth({ repoRoot: baselineDir });
  const codeIntelHealth = await graphHealth({ repoRoot: codeIntelDir });

  const baselineVerify = await graphPacket({ repoRoot: baselineDir, mode: 'verify', files: ['src/bar.cpp'] });
  const codeIntelVerify = await graphPacket({ repoRoot: codeIntelDir, mode: 'verify', files: ['src/bar.cpp'] });
  const codeIntelVerifyAudited = await graphPacket({ repoRoot: codeIntelDir, mode: 'verify', files: ['src/bar.cpp'], audited: true });

  const report = {
    summary: 'A/B comparison: verify mode without vs with code-intel',
    baseline: {
      health: { codeIntelAvailable: baselineHealth.codeIntel.available, reason: baselineHealth.codeIntel.reason },
      verify: {
        tokens_est: tokenEstimate(baselineVerify),
        chars: baselineVerify.length,
        explicit_unavailable: countSignals(baselineVerify, 'code_intel unavailable') > 0,
        diagnostics_block: countSignals(baselineVerify, 'DIAGNOSTICS') > 0,
        source_required: countSignals(baselineVerify, 'SOURCE_REQUIRED') > 0,
        evidence_provider: 'none'
      }
    },
    code_intel: {
      health: {
        codeIntelAvailable: codeIntelHealth.codeIntel.available,
        provider: codeIntelHealth.codeIntel.provider,
        status: codeIntelHealth.codeIntel.status,
        freshnessBasis: codeIntelHealth.codeIntel.freshnessBasis
      },
      verify: {
        tokens_est: tokenEstimate(codeIntelVerify),
        chars: codeIntelVerify.length,
        explicit_unavailable: countSignals(codeIntelVerify, 'code_intel unavailable') > 0,
        diagnostics_block: countSignals(codeIntelVerify, 'DIAGNOSTICS') > 0,
        source_required: countSignals(codeIntelVerify, 'SOURCE_REQUIRED') > 0,
        evidence_provider: codeIntelHealth.codeIntel.provider
      },
      verify_audited: {
        source_required: countSignals(codeIntelVerifyAudited, 'SOURCE_REQUIRED') > 0
      }
    },
    findings: []
  };

  // Acceptance findings — the things the superplan promises agents will see.
  const f = report.findings;
  f.push({
    test: 'baseline reports explicit unavailable (W3.4 Pi-graceful contract)',
    pass: report.baseline.verify.explicit_unavailable === true,
    detail: 'baseline packet must say "code_intel unavailable" rather than silently omit'
  });
  f.push({
    test: 'code-intel run shows provider name (W1.1 inline provenance)',
    pass: report.code_intel.health.provider === 'cpp-clangd',
    detail: 'health surfaces the active provider for trust assessment'
  });
  f.push({
    test: 'diagnostics surface in verify mode when present (W2.4)',
    pass: report.code_intel.verify.diagnostics_block === true,
    detail: 'post-edit diagnostics on touched files appear without separate build invocation'
  });
  f.push({
    test: 'audited flag promotes SOURCE_REQUIRED warning (W1.4 case d)',
    pass: report.code_intel.verify_audited.source_required === true,
    detail: 'agent must verify source even with code_intel evidence on audited code'
  });
  f.push({
    test: 'baseline does NOT silently emit diagnostics block (no false signal)',
    pass: report.baseline.verify.diagnostics_block === false,
    detail: 'absence of code-intel does not fabricate evidence'
  });

  const allPass = f.every(x => x.pass);
  report.allPass = allPass;

  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write('\n=== A/B DEMO: verify mode (baseline vs +code-intel) ===\n\n');
    process.stdout.write('--- BASELINE (no code-intel) ---\n');
    process.stdout.write(baselineVerify + '\n\n');
    process.stdout.write('--- WITH CODE-INTEL ---\n');
    process.stdout.write(codeIntelVerify + '\n\n');
    process.stdout.write('--- WITH CODE-INTEL + AUDITED ---\n');
    process.stdout.write(codeIntelVerifyAudited + '\n\n');
    process.stdout.write('--- FINDINGS ---\n');
    for (const finding of f) {
      process.stdout.write(`  [${finding.pass ? 'PASS' : 'FAIL'}] ${finding.test}\n`);
    }
    process.stdout.write(`\nResult: ${allPass ? 'ALL PASS' : 'FAILURES PRESENT'}\n`);
  }
  return allPass ? 0 : 1;
}

const jsonMode = process.argv.includes('--json');
run(jsonMode).then(code => process.exit(code)).catch(err => { console.error(err); process.exit(2); });
