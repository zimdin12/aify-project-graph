// THE FIVE BRIEF RENDERERS — extracted from generator.js.
//
// Each takes ONE plain `data` object, destructures it, and returns a string. No shared mutable
// state (measured: generator.js declares no module-level let/var), and after the artifacts slice
// no back-references into analysis.
//
// ⚠ THAT WAS NOT TRUE WHEN THE REFACTOR PROPOSAL CLAIMED IT. The proposal called this "the
// verified-cleanest seam ... no back-references into analysis" while SIX functions declared
// outside the render block were called from inside it — and moving the renderers then would
// have created a CIRCULAR IMPORT, because generator.js imports render.js to call these, while
// these needed `computeCoverage` from generator.js. brief/artifacts.js exists to break that,
// and it had to land first.
//
// ⇒ Re-measured after that slice: ZERO functions still in generator.js are CALLED from here.
// The five names that still appear — count, subsystems, hubs, risks, trust — are OBJECT KEYS in
// the rendered output, not calls. A \b-word matcher reports them as dependencies; call-syntax
// matching does not. That artefact has now shown up three times in this repo, so the check is
// written down rather than remembered.
//
// testSectionHeader and formatTaskLinkSummary moved WITH the renderers: they are pure
// formatting helpers that were misfiled in the analysis range, which the audit established by
// classifying every analysis function by data source — both take neither `db` nor an artifact.

import { join } from 'node:path';
import { computeCoverage, openTasksByFeature, completedTaskCountsByFeature, openTasksWithoutFeatures } from './artifacts.js';
import { loadTasksArtifact, summarizeDirtySeams, summarizeOverlayQuality, taskFeatureRefs, taskLinkStrength, taskLinkStrengthCounts } from '../overlay/quality.js';

export function renderMarkdown(data) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health, overlayHealth, architectureLayers = [] } = data;
  const lines = [];
  lines.push('# Project Brief');
  lines.push('');
  lines.push('## Snapshot');
  const langStr = snapshot.languages.map(l => `${l.name} (${l.files})`).join(', ');
  lines.push(`- ${snapshot.files} files, ${snapshot.symbols} symbols, ${snapshot.edges} edges`);
  if (langStr) lines.push(`- Languages: ${langStr}`);
  lines.push(`- Trust: **${health.level}**${health.issues.length ? ' — ' + health.issues[0] : ''}`);
  lines.push('');

  if (entries.length) {
    lines.push('## Entry points');
    for (const e of entries) lines.push(`- \`${e.file}:${e.line}\` — ${e.label} (${e.why})`);
    lines.push('');
  }

  if (subs.length) {
    lines.push('## Subsystems');
    for (const s of subs) lines.push(`- \`${s.path}\` — ${s.score} files`);
    lines.push('');
  }

  if (overlayHealth?.valid?.length) {
    lines.push('## Features');
    for (const { feature } of overlayHealth.valid) {
      const anchors = [...feature.anchors.symbols, ...feature.anchors.files].slice(0, 3).join(', ');
      lines.push(`- **${feature.label || feature.id}** (\`${feature.id}\`) — ${feature.description}${anchors ? ` · anchors: ${anchors}` : ''}`);
    }
    lines.push('');
  }

  // Plan #15 Step A5: Architecture layers (from .aify-graph/architecture.json
  // when present). Silent skip when no intelligence overlay is loaded.
  if (architectureLayers.length) {
    lines.push('## Architecture layers');
    for (const layer of architectureLayers) {
      const lowConfHint = layer.lowConfidenceCount > 0
        ? ` (${layer.lowConfidenceCount} low-confidence)`
        : '';
      lines.push(`- **${layer.name}** (\`${layer.id}\`) — ${layer.fileCount} files${lowConfHint}: ${layer.description}`);
    }
    lines.push('');
  }

  if (hubsArr.length) {
    lines.push('## Key symbols');
    for (const h of hubsArr) {
      lines.push(`- \`${h.label}\` (${h.role}) \`${h.file}:${h.line}\` — ${h.fan_in} incoming`);
    }
    lines.push('');
  }

  if (readFirstArr.length) {
    lines.push('## Read first');
    for (const r of readFirstArr) lines.push(`- \`${r.file}\` — ${r.why}`);
    lines.push('');
  }

  if (tests.length || risksArr.length) {
    lines.push('## Tests & risk');
    const inv = data.testInv;
    if (inv && inv.total > tests.length) {
      const mix = inv.systems.slice(0, 3).map((s) => `${s.ext} ${s.files}`).join(', ');
      lines.push(`- suite: ${inv.total} test files${mix ? ` (${mix})` : ''} — ${tests.length} shown`);
    }
    for (const t of tests) lines.push(`- test: \`${t.file}\` (${t.why})`);
    for (const r of risksArr) lines.push(`- risk: \`${r.file}\` (${r.why})`);
    lines.push('');
  }

  if (recent.length) {
    lines.push('## Recent activity');
    for (const c of recent) lines.push(`- ${c.date} \`${c.sha}\` ${c.author}: ${c.subject}`);
    lines.push('');
  }

  if (health.issues.length > 1) {
    lines.push('## Health notes');
    for (const issue of health.issues) lines.push(`- ${issue}`);
    lines.push('');
  }

  return lines.join('\n');
}
// Dense prompt substrate. Target ~300-450 tokens. No prose, key/value shape.
// A SHARED ARTIFACT THAT DOES NOT SELF-DATE ROTS SILENTLY.
//
// Field feedback (ef-manager, 2026-07-30): the briefs are the nearest thing this
// tool has to shared TEAM understanding of a codebase, and on his repo they sat 96
// days stale while four agents worked around them. The staleness was visible ONLY
// in graph_health — a verb none of them called. A brief read straight off disk
// looked authoritative and was three months out of date.
//
// So every brief states its own age in its own first line. A reader who never runs
// a verb still learns it. Days are computed from the indexed commit time, and the
// line stays short because it is prepended to a token-budgeted artifact.
export function briefAgeLine(indexedAt) {
  if (!indexedAt) return null;
  const t = Date.parse(indexedAt);
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  const stamp = new Date(t).toISOString().slice(0, 10);
  if (days <= 1) return `GENERATED: ${stamp} (today)`;
  const warn = days >= 14 ? ' — STALE, regenerate before trusting feature/task claims' : '';
  return `GENERATED: ${stamp} (${days}d ago)${warn}`;
}
export function renderAgentMarkdown(data) {
  const {
    snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent, health,
    overlayHealth, tooling, coverage, exports: exportsArr, paths, pathsHiddenCount = 0,
    overlayQuality, dirtySeams, manifestCommit, headCommit,
  } = data;
  const lines = [];
  const _age = briefAgeLine(data.manifestIndexedAt);
  if (_age) lines.push(_age);
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  // SNAPSHOT line: lets brief-only agents see indexed-vs-HEAD drift without
  // a live verb call. STALE marker when commits diverge.
  if (manifestCommit) {
    const idx = manifestCommit.slice(0, 7);
    const head = headCommit ? headCommit.slice(0, 7) : '?';
    const stale = headCommit && manifestCommit !== headCommit ? ' STALE' : '';
    lines.push(`SNAPSHOT: indexed=${idx} head=${head}${stale}`);
  }
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (tooling && tooling.length) lines.push(`TOOLING: ${tooling.join(', ')}`);
  // Never pair a truncated list with "fall back to direct file reads" — that
  // turns an arbitrary cut into a false scope contract (field report).
  if (coverage?.text) {
    lines.push(coverage.total > coverage.shown
      ? `COVERS: ${coverage.text} (${coverage.shown} of ${coverage.total} shown — see brief.plan.md for the rest; this is NOT the full scope)`
      : `COVERS: ${coverage.text}`);
  }
  // ⚠ OVERLAY DEGRADED — a legacy/invalid functionality.json silently resolves
  // to 0 anchors and the FEATURE map reads empty, which looks like the GRAPH
  // broke rather than the overlay being stale-format. Surface it LOUD right at
  // the orient entry point (Sand Castle report P0 #2: graph_health is rarely
  // opened mid-flow; brief.agent.md is). Fires on lint warnings OR when every
  // feature resolves zero anchors.
  {
    const lint = Array.isArray(data.overlay?.lint) ? data.overlay.lint : [];
    const featTotal = data.overlay?.features?.length || 0;
    const featBroken = data.overlayHealth?.broken?.length || 0;
    if (lint.length || (featTotal > 0 && featBroken === featTotal)) {
      const detail = lint[0] || `all ${featTotal} features resolve 0 anchors against the current graph`;
      lines.push(`⚠ OVERLAY DEGRADED: ${featBroken}/${featTotal} features resolve no anchors — ${detail}. The FEATURE map below is unreliable; migrate functionality.json (schema: docs/schemas/functionality.schema.json) or run /graph-build-functionality.`);
    }
  }
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (exportsArr && exportsArr.length) {
    // NOT_INDEXED hint: header includes total count so agent knows whether
    // the EXPORTS list is COMPLETE (e.g. 19/19 for MCP servers) or a
    // sampled top-N (fallback mode). If the agent's target isn't in this
    // list, they should grep rather than assume it doesn't exist.
    // Bench 2026-04-20 feedback: lc-trace agent asked for explicit
    // "what's NOT in the index" signal to fail fast on wrong premises.
    lines.push(`EXPORTS (${exportsArr.length} listed — target missing from list? grep):`);
    for (const ex of exportsArr) {
      lines.push(`  ${ex.name} ${ex.location}`);
    }
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) {
      const detail = s.edge_count !== undefined ? `${s.file_count}f ${s.edge_count}e` : `${s.score} files`;
      lines.push(`  ${s.path} (${detail})`);
    }
  }
  // FEATURES only if the user-authored overlay exists. Keeps briefs clean on
  // repos that haven't adopted functionality.json yet.
  if (overlayHealth?.valid?.length) {
    const total = overlayHealth.valid.length;
    const shown = Math.min(total, 5);
    const indicator = total > shown ? ` (showing ${shown}/${total} — see brief.plan.md or brief.json)` : '';
    lines.push(`FEATURES${indicator}:`);
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      const label = feature.label || feature.id;
      const anchors = feature.anchors.symbols.slice(0, 2).join(',');
      const deps = feature.depends_on.length ? ` deps=[${feature.depends_on.slice(0, 3).join(',')}]` : '';
      lines.push(`  ${feature.id}: ${label}${anchors ? ' [' + anchors + ']' : ''}${deps}`);
    }
  }
  if (overlayQuality?.featureCount) {
    const parts = [
      `tests=${overlayQuality.featuresWithTests}/${overlayQuality.featureCount}`,
      `docs=${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount}`,
      `deps=${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount}`,
      `related=${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}`,
    ];
    if (overlayQuality.tasksTotal > 0) parts.push(`tasks=${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}`);
    const taskStrengthSummary = formatTaskLinkSummary({
      strong: overlayQuality.strongTaskLinks,
      mixed: overlayQuality.mixedTaskLinks,
      broad: overlayQuality.broadTaskLinks,
    }, { includeZeros: overlayQuality.tasksTotal > 0 });
    if (taskStrengthSummary) parts.push(`task-links=${taskStrengthSummary}`);
    lines.push(`OVERLAY: ${parts.join(' ')}`);
  }
  if (hubsArr.length) {
    lines.push('INTERNAL_HUBS:');
    for (const h of hubsArr.slice(0, 4)) {
      lines.push(`  [${h.role}] ${h.label} ${h.file}:${h.line} fan=${h.fan_in}`);
    }
  }
  if (paths && paths.length) {
    // PATHS: pre-computed execution traces for top EXPORTS. Each line is
    // entry → file:line → file:line ... so trace tasks can answer from
    // brief without grep-chasing across files.
    lines.push('PATHS:');
    for (const p of paths.slice(0, 5)) {
      const chainStr = p.chain.map(n => `${n.name} ${n.file}:${n.line}`).join(' → ');
      lines.push(`  ${p.entry}: ${chainStr}`);
    }
    // Surface the noise filter count so a missing legitimate symbol is at
    // least visible. Vendor / type-name patterns can hide real call sites
    // on languages where the filter heuristic over-matches (e.g. a domain
    // class actually named `Vec4`). Without this line the omission was
    // silent — agents had no way to know the trace was filtered.
    if (pathsHiddenCount > 0) {
      lines.push(`  (PATHS HIDDEN: ${pathsHiddenCount} vendor/type-name nodes filtered — set GRAPH_PATHS_NOISE_DEBUG=1 to inspect)`);
    }
  }
  if (readFirstArr.length) {
    lines.push('READ:');
    for (const r of readFirstArr.slice(0, 4)) lines.push(`  ${r.file}`);
  }
  if (tests.length) {
    const shown = tests.slice(0, 3);
    lines.push(testSectionHeader('TESTS', shown.length, data.testInv));
    for (const t of shown) lines.push(`  ${t.file}`);
  }
  // RISKS: top high-fan-in / orphan files by inbound-ref count. Already in
  // brief.json.risks but previously only surfaced in brief.md and brief.plan.md.
  // Echoes A/B test (2026-04-26) showed agents missed risk-shaped concerns
  // when working only from brief.agent.md — this closes the gap with one cap-3
  // pre-baked section.
  if (risksArr && risksArr.length) {
    lines.push('RISKS:');
    for (const r of risksArr.slice(0, 3)) lines.push(`  ${r.file} (${r.why})`);
  }
  if (recent.length) {
    lines.push('RECENT:');
    for (const c of recent.slice(0, 3)) lines.push(`  ${c.date} ${c.subject}`);
  }
  if (dirtySeams?.totalDirtyFiles > 0) {
    const preview = dirtySeams.features.slice(0, 3).map((f) => `${f.id}(${f.file_count})`).join(', ');
    const orphan = dirtySeams.orphanDirtyFiles > 0 ? ` orphan=${dirtySeams.orphanDirtyFiles}` : '';
    // M4a: split source/docs vs scratch/build to reduce noise on repos with
    // active scratch dirs. dirtySeams.scratchDirtyFiles is computed in
    // overlay/quality.js when available; fall back to flat count otherwise.
    const scratch = dirtySeams.scratchDirtyFiles > 0 ? ` scratch=${dirtySeams.scratchDirtyFiles}` : '';
    lines.push(`DIRTY: ${dirtySeams.totalDirtyFiles} files${preview ? ' ' + preview : ''}${orphan}${scratch}`);
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}
// --- typed-brief variants (A2.2) ---
// brief.onboard.md: trimmed for "you're new here, what's the shape?"
// Drops RECENT/TESTS/RISKS, keeps ENTRY/SUBSYS/EXPORTS/INTERNAL_HUBS/READ/FEATURES/TRUST.
export function renderOnboardAgentMarkdown(data) {
  const { snapshot, entries, subs, hubsArr, readFirstArr, health, overlayHealth, tooling, coverage, exports: exportsArr } = data;
  const lines = [];
  const _age = briefAgeLine(data.manifestIndexedAt);
  if (_age) lines.push(_age);
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  const langStr = snapshot.languages.slice(0, 3).map(l => l.name).join(',');
  if (langStr) lines.push(`LANG: ${langStr}`);
  if (tooling && tooling.length) lines.push(`TOOLING: ${tooling.join(', ')}`);
  if (coverage?.text) {
    lines.push(coverage.total > coverage.shown
      ? `COVERS: ${coverage.text} (${coverage.shown} of ${coverage.total} shown)`
      : `COVERS: ${coverage.text}`);
  }
  if (entries.length) {
    lines.push('ENTRY:');
    for (const e of entries.slice(0, 3)) lines.push(`  ${e.file}:${e.line} ${e.label}`);
  }
  if (exportsArr && exportsArr.length) {
    lines.push('EXPORTS:');
    for (const ex of exportsArr.slice(0, 5)) {
      lines.push(`  ${ex.name} ${ex.location}`);
    }
  }
  if (subs.length) {
    lines.push('SUBSYS:');
    for (const s of subs.slice(0, 4)) {
      const detail = s.edge_count !== undefined ? `${s.file_count}f ${s.edge_count}e` : `${s.score} files`;
      lines.push(`  ${s.path} (${detail})`);
    }
  }
  if (overlayHealth?.valid?.length) {
    lines.push('FEATURES:');
    for (const { feature } of overlayHealth.valid.slice(0, 5)) {
      lines.push(`  ${feature.id}: ${feature.label || feature.id}`);
    }
  }
  if (hubsArr.length) {
    lines.push('INTERNAL_HUBS:');
    for (const h of hubsArr.slice(0, 4)) {
      lines.push(`  [${h.role}] ${h.label} ${h.file}:${h.line}`);
    }
  }
  if (readFirstArr.length) {
    lines.push('READ:');
    for (const r of readFirstArr.slice(0, 4)) lines.push(`  ${r.file}`);
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}
// brief.plan.md: for "I'm about to change something — what's the context?"
// Leads with FEATURES + anchors, then RECENT activity with feature
// attribution (similar-change context), then RISKS. Drops ENTRY/HUBS which
// are orient-specific noise for a change-planning session.
export function renderPlanAgentMarkdown(data) {
  const {
    snapshot, health, recentWithFiles, tasksArtifact, enrichedValid, enrichedRisks,
    overlayQuality, dirtySeams,
  } = data;
  const lines = [];
  const tasksByFeature = openTasksByFeature(tasksArtifact);
  const completedByFeature = completedTaskCountsByFeature(tasksArtifact);
  const _age = briefAgeLine(data.manifestIndexedAt);
  if (_age) lines.push(_age);
  lines.push(`REPO: ${snapshot.files}f ${snapshot.symbols}s ${snapshot.edges}e trust=${health.level}`);
  // FEATURES now carries action-bearing data: primary file + test anchor +
  // caller count. Agent can see "for this feature, open X, tests are at Y,
  // touching Z symbols will ripple to N callers" without another tool call.
  if (enrichedValid?.length) {
    // RANK, don't take the first 6 in declaration order. Field report: on a repo
    // with 14 features this rendered 6 — all infrastructure — and never reached
    // the five where 100% of the actual work lived. 20 of 21 linked tasks were
    // invisible, and the document contradicted itself: its own RISK section named
    // a feature it had never defined. A reader concluded the repo had one open
    // task on replay infrastructure.
    //
    // Order by what makes a feature worth reading TODAY: open tasks first (that
    // is live work), then dirty-seam overlap (that is what you are touching),
    // then blast radius. Declaration order carries no signal at all.
    const PLAN_FEATURE_CAP = 8;
    const dirtySet = new Set(
      (data.dirtySeams?.features || []).map((f) => (typeof f === 'string' ? f : f?.id)).filter(Boolean),
    );
    const rankedFeatures = [...enrichedValid].sort((a, b) => {
      const openA = (tasksByFeature.get(a.feature.id) || []).length;
      const openB = (tasksByFeature.get(b.feature.id) || []).length;
      if (openA !== openB) return openB - openA;
      const dirtyA = dirtySet.has(a.feature.id) ? 1 : 0;
      const dirtyB = dirtySet.has(b.feature.id) ? 1 : 0;
      if (dirtyA !== dirtyB) return dirtyB - dirtyA;
      return (b.callers_total || 0) - (a.callers_total || 0);
    });
    const shownFeatures = rankedFeatures.slice(0, PLAN_FEATURE_CAP);
    const hiddenFeatures = rankedFeatures.slice(PLAN_FEATURE_CAP);
    // Silent truncation is the failure this is fixing — never hide the hiding.
    lines.push(hiddenFeatures.length
      ? `FEATURES (showing ${shownFeatures.length} of ${rankedFeatures.length}, ranked by open tasks · dirty seams · blast radius):`
      : 'FEATURES:');
    for (const { feature, resolved, tests, callers_total } of shownFeatures) {
      const primaryFile = resolved.files[0] || '(no file anchor)';
      const primarySym = resolved.symbols[0] || '';
      const testStr = tests.length > 0 ? tests[0] : '(no test anchor)';
      const deps = feature.depends_on.length ? ` deps=[${feature.depends_on.slice(0, 3).join(',')}]` : '';
      lines.push(`  ${feature.id}: ${feature.label || feature.id}${deps}`);
      lines.push(`    open:  ${primaryFile}${primarySym ? ' (' + primarySym + ')' : ''}`);
      lines.push(`    tests: ${testStr}`);
      lines.push(`    load:  ${callers_total} callers across anchored symbols`);
      if ((feature.anchors.docs || []).length > 0) {
        lines.push(`    docs:  ${feature.anchors.docs.slice(0, 2).join(', ')}`);
      }
      if ((feature.related_to || []).length > 0) {
        lines.push(`    related: [${feature.related_to.slice(0, 3).join(',')}]`);
      }
      const featureTasks = tasksByFeature.get(feature.id) || [];
      const doneCount = completedByFeature.get(feature.id) ?? 0;
      if (featureTasks.length || doneCount > 0) {
        const taskLinkSummary = formatTaskLinkSummary(taskLinkStrengthCounts(featureTasks));
        const completed = doneCount > 0 ? `, ${doneCount} done` : '';
        lines.push(`    tasks: ${featureTasks.length} open${completed}${taskLinkSummary ? ` (${taskLinkSummary})` : ''}`);
        for (const t of featureTasks.slice(0, 2)) {
          lines.push(`      - ${t.id} ${t.title} [${taskLinkStrength(t)}]`);
        }
      }
    }
    // Name what was cut, so the omission is visible and addressable rather than
    // looking like the repo has no other features.
    if (hiddenFeatures.length) {
      const names = hiddenFeatures.map((h) => h.feature.id);
      const head = names.slice(0, 8).join(', ');
      lines.push(`  not shown (${hiddenFeatures.length}): ${head}${names.length > 8 ? `, +${names.length - 8} more` : ''}`);
      lines.push('    → graph_pull(node="feature:<id>") or graph_packet for any of these');
    }
  }
  if (overlayQuality?.featureCount) {
    lines.push('OVERLAY GAPS:');
    lines.push(
      `  tests ${overlayQuality.featuresWithTests}/${overlayQuality.featureCount} · docs ${overlayQuality.featuresWithDocs}/${overlayQuality.featureCount} · deps ${overlayQuality.featuresWithDependsOn}/${overlayQuality.featureCount} · related ${overlayQuality.featuresWithRelatedTo}/${overlayQuality.featureCount}${overlayQuality.tasksTotal > 0 ? ` · linked tasks ${overlayQuality.linkedTasks}/${overlayQuality.tasksTotal}` : ''}${overlayQuality.tasksTotal > 0 ? ` · task links ${formatTaskLinkSummary({ strong: overlayQuality.strongTaskLinks, mixed: overlayQuality.mixedTaskLinks, broad: overlayQuality.broadTaskLinks }, { includeZeros: true })}` : ''}`,
    );
    if (overlayQuality.featuresWithTests < overlayQuality.featureCount) {
      lines.push('  next: add explicit tests[] where one shared test file covers multiple features');
    }
    if (overlayQuality.unlinkedTasks > 0) {
      lines.push(`  next: attach ${overlayQuality.unlinkedTasks} open task(s) to a feature`);
    }
    if (overlayQuality.broadTaskLinks > 0) {
      lines.push(`  next: tighten ${overlayQuality.broadTaskLinks} broad task link(s) with path/tag/commit evidence where possible`);
    }
  }
  if (dirtySeams?.totalDirtyFiles > 0) {
    lines.push('DIRTY SEAMS:');
    for (const feature of dirtySeams.features.slice(0, 4)) {
      lines.push(`  ${feature.id}: ${feature.file_count} dirty file(s) · ${feature.files.slice(0, 2).join(', ')}`);
    }
    if (dirtySeams.orphanDirtyFiles > 0) {
      const sample = dirtySeams.orphanFilesSample.length ? ` · ${dirtySeams.orphanFilesSample.join(', ')}` : '';
      lines.push(`  orphan dirty files: ${dirtySeams.orphanDirtyFiles}${sample}`);
    }
  }
  const unattributed = openTasksWithoutFeatures(tasksArtifact);
  if (unattributed.length) {
    // Tasks that reference no feature still need visibility — previously
    // dropped from brief.plan.md silently. Cap at 5 so deeply-unmapped
    // backlogs don't flood the prompt.
    lines.push('UNATTRIBUTED TASKS:');
    for (const t of unattributed.slice(0, 5)) {
      lines.push(`  ${t.id} ${t.title}`);
    }
    if (unattributed.length > 5) {
      lines.push(`  +${unattributed.length - 5} more (attach to a feature in functionality.json)`);
    }
  }
  if (recentWithFiles?.length) {
    lines.push('RECENT (feature-tagged):');
    for (const c of recentWithFiles.slice(0, 6)) {
      const featureTag = c.features.length ? ' {' + c.features.slice(0, 3).join(',') + '}' : '';
      lines.push(`  ${c.date} ${c.sha}${featureTag} ${c.subject}`);
    }
  }
  if (enrichedRisks?.length) {
    lines.push('RISK:');
    for (const r of enrichedRisks.slice(0, 3)) {
      // Uniform tagging — feature membership OR explicit orphan marker, plus
      // nearest test OR "no nearby test." High-fan-in files with no feature
      // are the orphan-detection signal surfaced inline; tests-or-nothing is
      // better than a silent missing suffix.
      const featureTag = r.features.length
        ? ` in [${r.features.slice(0, 2).join(',')}]`
        : ' (orphan — no feature)';
      const testTag = r.nearest_test ? ` · test: ${r.nearest_test}` : ' · no nearby test';
      lines.push(`  ${r.file} (${r.why})${featureTag}${testTag}`);
    }
  }
  if (health.issues.length) {
    const tip = health.tip ? ` → ${health.tip}` : '';
    lines.push(`TRUST ${health.level}: ${health.issues.join('; ')}${tip}`);
  } else {
    lines.push(`TRUST ${health.level}`);
  }
  return lines.join('\n');
}
export function renderJson(data, repoRoot) {
  const {
    snapshot, entries, subs, hubsArr, readFirstArr, tests, risksArr, recent,
    health, overlay, overlayHealth, brokenFeatureEdges, tasksArtifact,
    overlayQuality, dirtySeams,
  } = data;
  // Pre-compute tasks-by-feature so programmatic consumers of brief.json
  // (e.g. /graph-walk-bugs, future graph-lint) don't need to re-parse
  // tasks.json and re-apply the open/attribution filter. Echoes PM
  // feedback 2026-04-21: "per-feature task counts are only in brief.plan.md
  // (rendered) and have to be recomputed from tasks.json by any consumer."
  const tasksByFeature = openTasksByFeature(tasksArtifact);
  return {
    // We intentionally use manifest.indexedAt (already emitted) rather than a
    // fresh Date.now() for graph_indexed_at: adding wall-clock on every
    // render would defeat the content-hash-guarded cache that keeps brief
    // files byte-identical across no-op regens. Echoes PM Tier B #8 wanted
    // "brief is fresh but graph is N commits behind" detection — same
    // manifest.indexedAt gives them that signal without the cache churn.
    graph_indexed_at: data.manifestIndexedAt ?? null,
    graph_commit: data.manifestCommit ?? null,
    repo: {
      root: repoRoot,
      files: snapshot.files,
      symbols: snapshot.symbols,
      edges: snapshot.edges,
      languages: snapshot.languages,
      trust: { level: health.level, unresolved_edges: snapshot.unresolvedEdges, issues: health.issues },
    },
    entrypoints: entries,
    subsystems: subs,
    hubs: hubsArr.map(h => ({ label: h.label, type: h.type, role: h.role, file: h.file, line: h.line, fan_in: h.fan_in })),
    read_first: readFirstArr,
    tests,
    // The anchors are a SAMPLE. Programmatic consumers need the denominator and
    // the per-extension breakdown to know which suite the sample came from.
    test_inventory: data.testInv ?? null,
    risks: risksArr,
    recent_activity: recent,
    overlay_quality: overlayQuality,
    dirty_seams: dirtySeams,
    features: {
      version: overlay?.version ?? null,
      valid: (overlayHealth?.valid ?? []).map(v => {
        const featureTasks = tasksByFeature.get(v.feature.id) ?? [];
        const contractCount = (v.feature.contracts ?? []).length;
      return {
        id: v.feature.id,
        label: v.feature.label,
        description: v.feature.description,
        anchors: v.feature.anchors,
        tests: v.feature.tests,
        depends_on: v.feature.depends_on,
        related_to: v.feature.related_to,
          resolved_anchors: v.resolved,
          anchor_health: `${v.totalResolved}/${v.totalDeclared}`,
          // Pre-materialized task binding so programmatic consumers (e.g.
          // /graph-walk-bugs) don't re-parse tasks.json. Capped at 10 per
          // feature to keep brief.json size bounded on task-heavy repos;
          // task_count reports the true total.
          task_count: featureTasks.length,
          tasks: featureTasks.slice(0, 10).map(t => ({
            id: t.id,
            title: t.title ?? '',
            status: t.status ?? null,
            priority: t.priority ?? null,
            url: t.url ?? null,
            link_strength: taskLinkStrength(t),
            evidence: t.evidence ?? null,
          })),
          // Coverage gradient: composite health signal so a reader can tell
          // skeletal features from load-bearing ones at a glance. Three tiers:
          //   🟢 healthy: anchors resolve, has contract, low task overhang
          //   🟡 watch:   anchors resolve but thin (no contract OR >10 tasks)
          //   🔴 risk:    broken anchors OR severe task overhang (>20)
          // Pure synthesis from the fields above — no new data.
          coverage: computeCoverage({
            resolved: v.totalResolved,
            declared: v.totalDeclared,
            taskCount: featureTasks.length,
            contractCount,
          }),
        };
      }),
      broken: (overlayHealth?.broken ?? []).map(v => ({
        id: v.feature.id,
        label: v.feature.label,
        depends_on: v.feature.depends_on,
        missing_anchors: v.resolved,
        anchor_health: `${v.totalResolved}/${v.totalDeclared}`,
      })),
      broken_edges: (brokenFeatureEdges ?? []),
    },
  };
}
// The rendered TESTS block is a 3-file SAMPLE. Naming three files with no
// denominator invites the exact misread seen in the field: the sample was taken
// for the repo's entire test system. State the total and the per-extension mix so
// the dominant suite is visible even when the sample cannot show it.
export function testSectionHeader(label, shown, inv) {
  if (!inv || inv.total <= shown) return `${label}:`;
  const mix = inv.systems.slice(0, 3).map((s) => `${s.ext} ${s.files}`).join(', ');
  return `${label} (showing ${shown} of ${inv.total}${mix ? `; ${mix}` : ''}):`;
}
export function formatTaskLinkSummary(counts = {}, { includeZeros = false } = {}) {
  const parts = [];
  if (includeZeros || counts.strong > 0) parts.push(`${counts.strong ?? 0} strong`);
  if (includeZeros || counts.mixed > 0) parts.push(`${counts.mixed ?? 0} mixed`);
  if (includeZeros || counts.broad > 0) parts.push(`${counts.broad ?? 0} broad`);
  return parts.join(', ');
}
