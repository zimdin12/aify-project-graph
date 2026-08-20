#!/usr/bin/env node
// Self-heal platform-mismatched better-sqlite3 before any DB-dependent
// imports load. Import for side effects only — it throws if unrecoverable.
import './preflight-native.js';
import readline from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';
import { stopAllDashboards } from './query/verbs/dashboard.js';
import { checkRequestSize, MAX_MCP_LINE_BYTES } from './security/request-size.js';
import { findSensitivePathArg } from './security/sensitive-paths.js';
import { SERVER_INSTRUCTIONS } from './server-instructions.js';
import { buildSessionSeed } from './session-seed.js';
import { shutdownAllSessions } from './code-intel/live.js';
import { noteDeprecatedVerbCall, noteProbeArmed } from './deprecation-probe.js';
import { HIDDEN_FULL_TOOL_NAMES } from './hidden-tools.js';
// The 42 tool declarations live in tools/schema.js — 614 lines of schema that were sitting
// beside the dispatcher. 34 handler imports moved with them; see that file's header.
import { TOOLS } from './tools/schema.js';


// 2026-04-26: every tool accepts an optional `repo` arg that overrides
// the MCP server's process.cwd(). The `tools/call` handler already routes it
// to repoRoot; we only need to declare it in JSON Schema so agents can
// discover and pass it. Critical for sessions launched from a non-repo
// cwd (home dir, scratch dir) where every live verb otherwise returns
// trust=missing. Found by 2026-04-26 echoes A/B test contamination.
const REPO_ARG_SCHEMA = {
  type: 'string',
  // Inlined into all 17 listed verbs — see the note on FRESH_PARAM.
  description: 'Absolute path to the target repo. Only needed when the server was not launched from inside it; defaults to process.cwd().',
};
for (const tool of TOOLS) {
  if (!tool.schema) tool.schema = { type: 'object', properties: {} };
  if (!tool.schema.properties) tool.schema.properties = {};
  if (!tool.schema.properties.repo) tool.schema.properties.repo = REPO_ARG_SCHEMA;
}

// Lean profile (v3, 2026-04-22): redesigned from the old impact/path/plan
// trio after the combined v1+v2 Codex + Claude bench feedback showed:
// - `graph_consequences` was the consistently highest-rated live planning verb
// - `graph_pull` carried the overlay-dependent wins briefs couldn't answer alone
// - `graph_change_plan` was the only old lean verb with repeat positives
// Evidence: docs/dogfood/ab-results-2026-04-20-cross-tester.md and manager's
// v1+v2 lean-half post-mortem notes. Hidden verbs remain callable via tools/call.
// Note: lean grew 3→5 across two refinements to the 2026-04-25 v2
// upgrade plan. graph_packet is the new flagship one-shot primitive
// (feature/task targets read overlay+brief directly, no ensureFresh/no SQL;
// bare-symbol fallback may do one budgeted mapping lookup); change_plan
// stays visible until packet is measured as a full substitute;
// graph_health was added (M4a alignment) because the skill heavily
// recommends it as the fastest health check and it was previously
// callable but not visible — discoverability mismatch surfaced by
// the validation gate.
const LEAN_TOOL_NAMES = new Set([
  'graph_packet',
  'graph_consequences',
  'graph_pull',
  'graph_change_plan',
  'graph_health',
  // Review-fix #7: graph_watch is the agent-facing primitive for enabling
  // the file-watcher → auto-reindex hook (Plan #18 A). Hiding it from the
  // lean profile's tools/list would make every lean-runtime agent unable
  // to discover the verb even though it's the documented opt-in path.
  'graph_watch',
]);

// Verbs that WRITE state — everything else is annotated `readOnlyHint: true` in
// tools/list. Kept explicit (deny-list) rather than derived, so a new verb is
// read-only only when someone says so.
//
//   graph_index                — rebuilds the graph + briefs on disk
//   graph_collect_code_intel   — runs an LSP collection and imports edges
//   graph_watch                — starts/stops the file-watcher auto-reindex loop
//
// The rest reach `prepareCompileDb`, which MATERIALIZES a normalized
// compile_commands.json under .aify-graph/code-intel/ — a real filesystem write.
// `readOnlyHint` is a promise to the client (Cursor's Ask mode gates on it), so
// claiming it for a verb that writes would be buying access with an untrue
// assertion. They are listed here because the annotation must be accurate, even
// though the write is an internal cache rather than a user-visible mutation.
// `fresh` is advertised on every READ verb rather than declared per tool.
//
// Freshness is a per-QUESTION decision. A read against a snapshot is correct and
// cheap for orientation; a read that will justify an edit or a deletion needs the
// graph to match HEAD. Only the caller knows which one this call is, so the
// parameter belongs on the call — not solely in APG_AUTO_REINDEX, which forces one
// answer on an entire install.
//
// The description is written to tell an agent WHEN to reach for it, since a flag
// whose cost is invisible gets either ignored or set on everything.
const FRESH_PARAM = Object.freeze({
  type: 'boolean',
  default: false,
  // Kept short because this object is INLINED INTO 10 VERBS' schemas, so every
  // sentence here is billed ten times in every session. At its previous length
  // it cost 1820 tokens across the listing — more than all 17 verb descriptions
  // combined. What survives is the decision rule (when true, when false, what it
  // costs); the rationale behind that rule moved to the comment above.
  description:
    'Reindex to match HEAD before answering. DEFAULT false — reads are cheap and any staleness is '
    + 'reported in the response, so you decide. Set true only when the answer will justify an ACTION '
    + '(safe-to-delete, who-calls-before-I-change, blast radius) AND the graph is reported stale. '
    + 'COST: seconds to minutes on a large repo. This is the FALLBACK path — it refreshes while you '
    + 'wait. The primary is the refresh hooks (install-graph-hook.mjs), which refresh when HEAD moves.',
});

function withFreshParam(tool) {
  if (MUTATING_TOOLS.has(tool.name)) return tool.schema;
  const schema = tool.schema ?? { type: 'object', properties: {} };
  if (schema.properties?.fresh) return schema; // verb declares its own
  return {
    ...schema,
    properties: { ...(schema.properties ?? {}), fresh: FRESH_PARAM },
  };
}

const MUTATING_TOOLS = new Set([
  'graph_index',
  'graph_collect_code_intel',
  'graph_watch',
  // Reach computeCoverage/prepareCompileDb (normalized compile-DB write):
  'graph_health',
  'graph_callers',
  'graph_callees',
  'graph_trace',
  'code_intel_references',
  'code_intel_definitions',
  'code_intel_hierarchy',
  'code_intel_diagnostics',
  'code_intel_hover',
  'code_intel_symbols',
  'code_intel_analyze',
]);

// DEFAULT profile (P4-1, 2026-05-31): the ACTUAL default `tools/list` surface
// when no `--toolset`/AIFY_GRAPH_PROFILE is set. The Hermes tech-lead's
// finish-line point: ~40 verbs is fine as an EXPERT/full API but too many as
// the agent's DEFAULT affordance — agents under-pick from big lists. So we GATE
// the listing (not delete the verbs): the default surface is the ~15 intent
// verbs an agent actually reaches for. `full` becomes an explicit opt-in that
// lists everything (minus HIDDEN_FULL). Every verb here AND every verb not here
// stays CALLABLE via tools/call regardless of profile — gating = listing only.
//
// The set is Hermes-TL's list, refined: the primary cross-layer planning verbs
// (packet/pull/consequences), the traversal verbs (callers/impact/trace/
// explore), diff explanation, the ONE analytics front door (digest), locators
// (search/whereis), the health check, and the code-intel front (collect +
// references + hierarchy). Everything else (callees/neighbors/path/shader/file/
// onboard/status/index/watch/dashboard/overview/hotspots/cycles/change_plan/
// preflight/module_tree/report/summary/lookup + the code_intel long-tail) stays
// callable but unlisted by default.
const DEFAULT_TOOL_NAMES = new Set([
  'graph_packet',
  'graph_pull',
  'graph_consequences',
  'graph_callers',
  'graph_impact',
  'graph_trace',
  'graph_explore',
  // ⛔ `graph_explain_diff` AND `graph_digest` WERE DROPPED FROM THIS LISTING (Phase 3c).
  //
  // ef-manager's usage across the whole review arc: FIVE of seventeen verbs ever called —
  // graph_health (every round, "highest-value call in the set"), graph_whereis, graph_search,
  // graph_packet, graph_impact (once, found a bug).
  //
  // ★ THE DATUM THEY SAID TO ACT ON IS NOT THE ZERO COUNTS. It is where they went INSTEAD: three
  // times they had a real question, had the full verb list in front of them, and went to raw
  // sqlite. Each produced a finding. "Presence did not steer me wrong; it steered me NOWHERE."
  // A listed verb that never gets picked is not neutral — it is schema billed on every session
  // (tools/list is always-paid, and most of it is schema) for salience that is not working.
  'graph_search',
  'graph_whereis',
  'graph_health',
  'graph_collect_code_intel',
  'code_intel_references',
  'code_intel_hierarchy',
  // Listed so managed workers can SELF-REFRESH a stale graph. The 2026-06-01
  // Sand Castle A/B found a stale graph is worse than none for workers who get
  // the read verbs but not graph_index — they couldn't act on the "run
  // graph_index" staleness warning because it wasn't in their surface.
  'graph_index',
  // Listed so "open/show me the graph" is ONE verb call ({url,port}, keeps
  // serving) instead of agents hand-rolling a server launcher when the verb was
  // unlisted (2026-06 field report).
  'graph_dashboard',
]);

// ⛔ I REFUSED TO DROP `graph_index` AND `graph_dashboard`, WHICH PHASE 3c ALSO LISTED.
//
// ef-manager's argument is that "three of them are things a human runs, not an agent mid-task",
// and their call counts support it. But BOTH of those verbs are in this set BECAUSE OF RECORDED
// HARM WHEN THEY WERE ABSENT, and a usage count does not address absence-harm evidence:
//
//   graph_index      2026-06-01 Sand Castle A/B — a stale graph is WORSE than none for managed
//                    workers who got the read verbs but not this one. They could not act on the
//                    "run graph_index" staleness warning because it was not in their surface.
//   graph_dashboard  2026-06 field report — agents hand-rolled a server launcher when it was
//                    unlisted.
//
// ⚠ A SUPPORTING ARGUMENT, WITH ITS PROVENANCE STATED EXACTLY.
//
// `docs/2026-08-19-roadmap.md:208-212` (introduced by afbc4ad) records ef-manager refusing to
// advise on seven other verbs: "zero calls is evidence I was not doing the work they serve. Do NOT
// let me be the reason those get cut — a drop decision on my numbers alone would be the
// consumer-enumeration mistake again." Their calls on graph_index and graph_dashboard are also
// zero, for the same reason — a reviewer grading precision never re-indexes or opens a dashboard —
// so the caveat covers these two unchanged.
//
// ⛔ THAT LINE IS A TRANSCRIPTION, NOT THE ORIGINAL MESSAGE, AND ef-manager COULD NOT CONFIRM IT.
// Asked to verify, they said their session had been compacted and the quote was not in the context
// they carry: "I will not confirm reasoning I cannot see just because it sounds like mine and the
// conclusion is one I agree with." Pinned to a commit is not the same as verified against a
// primary source — a committed transcription is immutable and still only as good as whoever
// transcribed it, which was me.
//
// ⇒ SO THE DECISION DOES NOT REST ON IT. The load-bearing evidence is the two field reports above,
// which are records of observed HARM rather than of anyone's opinion. If the quote were withdrawn
// entirely, `graph_index` and `graph_dashboard` still stay on absence-harm and this comment loses
// a corroborating argument, not its basis.
//
// ⇒ So two of the four are dropped on absence of counter-evidence, and two are KEPT on presence
// of it. Reversing a field-driven decision on usage data alone is how a fix gets undone by someone
// who never saw the failure it prevented.

// Full profile still keeps EVERY verb callable by name, but the tools/list
// surface hides the redundant + long-tail verbs so the listed set reads as ONE
// coherent product instead of a 37-verb salience wall (R2 cohesion fix). Hidden
// verbs are still invokable via tools/call — this trims the passive manifest
// tax only. Three buckets:
//   1. Legacy locator aliases briefs replaced (lookup, summary, report).
//   2. Planning verbs redundant with graph_packet modes — change_plan +
//      preflight share computeDecision with packet's verify/plan paths.
//   3. Analytics long-tail — graph_digest is the ONE analytics front door and
//      composes overview/hotspots/cycles; the rest stay callable but unlisted.
//      module_tree (directory roll-up) folds in here as long-tail orientation.
//   4. Replay/analyze code-intel long-tail — the live code_intel_* primaries
//      (references/definitions/hover/symbols/diagnostics/hierarchy) are the
//      coherent front; replay (parent-session reads) + analyze (clang-tidy/
//      build) are specialist follow-ups.
// HIDDEN_FULL_TOOL_NAMES now lives in ./hidden-tools.js so the deprecation probe
// derives from the SAME source — see that file for why the two unlisted sets are not
// the same thing.

// Tier B — kept visible in `tools/list` but with a one-line description in
// place of the full prose. Agents can still discover them by name, and the
// short form cuts the manifest token tax on verbs that are useful but rarely
// the first reach. Full descriptions are used whenever the tool is actually
// invoked; this only shapes the listing.
// ★ graph_health WAS IN HERE AND MUST NOT BE. This tier is documented as verbs that
// are "rarely the first reach" — and graph_health is the verb the server
// instructions tell agents to run FIRST. It was being listed as 66 characters
// ("Graph trust + dirty-edge breakdown") while its real description explains when to
// call it and what would make you distrust every OTHER verb's answer.
//
// A field reviewer read tools/list cold and failed it on exactly that: the one verb
// whose purpose is "can I trust what I am about to be told" was the only one in the
// set saying nothing about when to doubt it. Its output had told him the feature
// overlay was 99 DAYS stale — the fact that discounts graph_consequences' inferred
// fields — and nothing in the listing connected the two.
//
// The short-form tier is a real token optimisation and stays. It just must not
// contain the verb that calibrates the others.
// Tier-B listing overrides. `tools/list` is UNCONDITIONAL — every listed verb's
// description is in context from the first token of every session, whether or
// not the agent ever touches the graph. A skill body is the opposite: it costs
// nothing until invoked. So the long form belongs in the skill and this surface
// pays only for what a SELECTION decision needs.
//
// The rule each entry follows: keep (a) what the verb is for, and (b) when to
// distrust its answer. Everything else — parameter detail, resume semantics,
// output schema, worked examples, measurement history — is already carried by
// the skills (verified: every clause removed here appears in skill/SKILL.md,
// skills/graph-guide, or skills/cpp-inner-loop) and is dropped from here.
//
// (b) is not optional. Several of these verbs answer questions where a confident
// wrong answer deletes code — graph_callers undercounts C++ dispatch,
// code_intel_references returns empty when the index could not answer. Those
// clauses stay in the always-loaded surface precisely because they must not
// depend on the agent having chosen to load a skill first.
const SHORT_DESCRIPTIONS = new Map([
  ['graph_search',      'Fuzzy symbol search. Use when the exact name is unknown.'],
  ['graph_file',        'Whole-file digest (symbols + exports). Use when briefs do not cover the file.'],

  ['graph_health',      'FIRST CALL of any session: "can I trust what this graph is about to tell me?" Trust level, staleness, coverage, and up to 3 ranked next actions — EMPTY on a healthy repo, which is what makes a populated list mean something. ★ SCOPE: this verdict constrains GRAPH-backed verbs only; the live code_intel_* verbs query the language server directly. For a delete decision read evidence.exhaustive on code_intel_references, not this summary.'],

  ['graph_packet',      'ORIENTATION packet for a task/feature/symbol — use when you do NOT yet have a precise question. If you already know the question ("what breaks if I change X" -> graph_consequences; "who calls X" -> code_intel_references), call that verb instead: this is NOT a mandatory first step. Returns ~500-900 tokens of fixed-schema markdown. mode=orient|plan|debug|review|audit|verify; verify is post-edit and takes files[] instead of a target.'],

  ['code_intel_references', 'Compiler-backed "who references this symbol", asked of the LIVE language server — the only verb whose answer can support a delete or rename decision. ★ READ evidence BEFORE CONCLUDING: exhaustive:true means an absence of callers is real; degraded:true with a cause means the index could not answer, and ZERO REFERENCES IS THEN NOT EVIDENCE OF NO CALLERS. On a cold session pass waitForReadyMs (e.g. 25000), or a CORRECT answer comes back unattested and cannot license a deletion.'],

  ['graph_collect_code_intel', 'Run a compiler/LSP-backed collection (clangd for C++) and import it as [lsp✓] verified edges. ★ THIS CALL DELETES DATA: a COMPLETE collect supersedes and DISCARDS the prior collection for the same provider. A PARTIAL collect does not. EXPLICIT ONLY — never auto-runs. A cold first run is time-budgeted and returns status:"partial" — that is NOT a failure; call it again until index.filesTotal is 0.'],

  ['graph_callers',     'Incoming execution edges for a symbol from the STORED graph. ★ HEURISTIC BY DEFAULT: tree-sitter extraction UNDERCOUNTS C++ virtual and cross-TU dispatch — on one measured project it found half the calling files. Use as a LEAD, never as evidence of completeness; for a delete decision use code_intel_references and read evidence.exhaustive. Promoted to [lsp✓] where a collection verified the edge.'],

  ['code_intel_hierarchy', 'Transitive call hierarchy (callers/callees) or type hierarchy (subtypes/supertypes) from the live language server, to a bounded depth. Requires kind. Use for "who ultimately reaches this" or "what overrides this virtual" — questions a single hop cannot answer. ★ READ evidence: an empty result carrying degraded:true means cross-TU resolution failed, NOT that nothing calls it. Pass waitForReadyMs on a cold session.'],

  ['graph_consequences', '"What breaks if I touch X?" — cross-layer blast radius for a symbol or file: contracts, features, open tasks, adjacent tests, history, risk flags. Use BEFORE planning a non-trivial change. ★ READ field_provenance: each field is observed (graph structure) or inferred (curated overlay); an absent INFERRED entry is NOT evidence of absence. Lists carry {items,truncated} — check truncated before treating one as complete. Returns a portable receipt a second agent can validate.'],

  ['graph_trace',       'PRIMARY for "show me the whole call path from A to B" — the entire trace in ONE call, each hop body inlined verbatim (treat as already Read; do NOT re-Read the files it shows). Bridges C++ virtual dispatch via OVERRIDDEN_BY; [lsp✓] marks clangd-verified hops, INFERRED marks dynamic ones. Capped at max_hops. On no static path it NAMES the likely dispatch boundary instead of returning nothing.'],

  ['graph_explore',     'PRIMARY for "show me the source of these N symbols" — verbatim Read-equivalent source for a BAG of names in ONE budget-capped call, grouped by file. Do NOT re-Read the files it shows. Input is a LIST OF NAMES, not a question. Emits a TRUNCATED tail when over budget — narrow the list rather than assuming you saw everything. For the call PATH between two symbols use graph_trace.'],

  ['graph_explain_diff', 'Explain an EXISTING change/diff (the reverse of graph_consequences). Keyed on a git range, NOT a symbol: range / staged=true / files[]; defaults to uncommitted working-tree changes. Returns CHANGED, AFFECTED 1-hop, LAYERS, RISK (a labeled heuristic score), TESTS, carrying the LSP-vs-heuristic trust banner. Use when triaging a PR or an already-made change.'],

  // ⚠ THE TIER ASYMMETRY, ef-manager 2026-08-19. A SKILL is a file an agent CHOOSES to load; a
  // tool description is what EVERY agent sees at selection time, unconditionally. The whereis
  // scope work landed in the skill and left this tier saying "Exact symbol definition lookup.
  // Prefer this for known names." — so an agent that reads only the schema had no way to know
  // that NO MATCH means "not among the populated declaration types" rather than "not in this
  // repo". Three separate field findings all cashed out as that one misreading.
  //
  // ⇒ Detail belongs in the skill, which is free until invoked. The DOUBT belongs here, which
  // is billed every session, because it is what stops the answer being misread.
  ['graph_whereis',     'Exact-label definition lookup over DECLARATION types, stating its population as "N of M". ★ A MISS IS NOT ABSENCE FROM THE REPOSITORY — it means no node carried that exact label among the declaration types THIS graph populated, and the miss names which of those types have zero nodes. Module constants are not extracted, so a `const` not bound to a function answers NO MATCH while existing in the source. Given a FILE PATH it says so and routes to graph_packet/graph_pull instead of implying the file is missing. limit must be 1 or more.'],

  ['graph_pull',        'Cross-layer pull for a node (file, feature, symbol, or task). Default layers code+functionality+tasks+activity; opt-in docs, relations, transitive. ★ In relations, recompile_surface answers "what must I rebuild": terminated:true means the walk ran out of includers, while truncated/depth_capped means the number is a FLOOR. imported_by is hop 1 only and is the WRONG answer when the includers are themselves headers.'],
]);

function projectToShortDescription(tool) {
  const short = SHORT_DESCRIPTIONS.get(tool.name);
  return short ? { ...tool, description: short } : tool;
}

function resolveToolset(argv = process.argv.slice(2), env = process.env) {
  // Precedence: explicit --toolset wins, then AIFY_GRAPH_PROFILE env, then the
  // focused `default` profile (P4-1). `full` is now an explicit opt-in — the
  // bare default surface is the ~15-verb intent set, not the whole API. The
  // games' .mcp.json (which passes no --toolset) gets the focused default;
  // that is intentional.
  const arg = argv.find(token => token.startsWith('--toolset='));
  if (arg) return arg.slice('--toolset='.length);
  const envProfile = (env.AIFY_GRAPH_PROFILE || '').trim();
  return envProfile || 'default';
}

// APG_MCP_TOOLS — comma-separated env allowlist (codegraph's pattern). When
// set, it restricts the LISTED tools to EXACTLY that set, intersected with
// whatever the resolved profile would have shown — for A/B ablation studies.
// Tools omitted by the allowlist are truly absent from tools/list but stay
// CALLABLE via tools/call (gating = listing only). Unknown names are ignored.
// Empty/whitespace-only → no restriction. Example:
//   APG_MCP_TOOLS=graph_packet,graph_pull,graph_consequences
function parseToolsAllowlist(env = process.env) {
  const raw = (env.APG_MCP_TOOLS || '').trim();
  if (!raw) return null;
  const names = raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return names.length ? new Set(names) : null;
}

function defaultOutputMode(toolset, env = process.env) {
  if ((env.AIFY_GRAPH_OUTPUT || '').trim()) return env.AIFY_GRAPH_OUTPUT;
  return toolset === 'lean' ? 'compact' : '';
}

const CODE_INTEL_TOOL_NAMES = new Set([
  'code_intel_diagnostics',
  'code_intel_references',
  'code_intel_definitions',
  'code_intel_hover',
  'code_intel_symbols',
  'code_intel_hierarchy',
  'code_intel_replay',
  'code_intel_analyze',
  'graph_collect_code_intel',
  'graph_packet',
  'graph_health'
]);

function selectListedTools(toolset) {
  if (toolset === 'lean') {
    return TOOLS.filter(tool => LEAN_TOOL_NAMES.has(tool.name));
  }
  if (toolset === 'code-intel') {
    return TOOLS.filter(tool => CODE_INTEL_TOOL_NAMES.has(tool.name));
  }
  if (toolset === 'full') {
    return TOOLS
      .filter(tool => !HIDDEN_FULL_TOOL_NAMES.has(tool.name))
      .map(projectToShortDescription);
  }
  // `default` (and any unrecognized profile name) → the focused intent set.
  // Short descriptions still apply so the listed set stays tight.
  return TOOLS
    .filter(tool => DEFAULT_TOOL_NAMES.has(tool.name))
    .map(projectToShortDescription);
}

// Apply the APG_MCP_TOOLS allowlist (if set) as a final listing filter on top
// of the profile selection. Restricts what tools/list shows; never changes
// what tools/call can invoke.
function applyAllowlist(listed, allowlist) {
  if (!allowlist) return listed;
  return listed.filter(tool => allowlist.has(tool.name));
}

const ACTIVE_TOOLSET = resolveToolset();
const ACTIVE_TOOLS = TOOLS;
const TOOLS_ALLOWLIST = parseToolsAllowlist();
const LISTED_TOOLS = applyAllowlist(selectListedTools(ACTIVE_TOOLSET), TOOLS_ALLOWLIST);
const DEFAULT_OUTPUT_MODE = defaultOutputMode(ACTIVE_TOOLSET);
if (DEFAULT_OUTPUT_MODE) {
  process.env.AIFY_GRAPH_OUTPUT = DEFAULT_OUTPUT_MODE;
}

const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }

rl.on('line', async (line) => {
  // Plan #21 — input-size cap. Refuse oversize lines BEFORE JSON.parse
  // forces a giant string allocation. Returns a JSON-RPC structured
  // error rather than process.exit per senior-dev's lock.
  const oversize = checkRequestSize(line);
  if (oversize) { send(oversize); return; }

  let req;
  try {
    req = JSON.parse(line);
  } catch {
    // JSON-RPC 2.0 §4.2 — respond with -32700 Parse error so clients
    // waiting on a matching id don't hang until their own timeout.
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!req || typeof req !== 'object') {
    send({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }

  if (req.method === 'initialize') {
    send({
      jsonrpc: '2.0', id: req.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'aify-project-graph', version: '0.1.0' },
        // P1-1 — intent-routed playbook. MCP hosts inject this into the agent
        // system prompt once/session; single source of truth in
        // server-instructions.js.
        // Static playbook (HOW to use us) + a per-repo seed (WHAT this repo's
        // graph actually knows). Without the seed an agent learns the API and
        // still has no reason to believe we hold anything for its task.
        instructions: (() => {
          const seed = buildSessionSeed(process.cwd());
          return seed ? `${SERVER_INSTRUCTIONS}\n\n${seed}` : SERVER_INSTRUCTIONS;
        })(),
      },
    });
    return;
  }

  if (req.method === 'notifications/initialized') return;

  if (req.method === 'tools/list') {
    // ★ ARM THE DENOMINATOR. A tools/list call means a host is building its callable
    // set from the listing — so if these verbs are filtered out of it, that host CANNOT
    // reach them however much it might want to. ef-manager measured 0 of 11 reachable on
    // exactly such a host, which means an empty call log proves nothing about demand.
    //
    // `hostCanReachUnlisted` is false whenever any watched verb is absent from what we
    // are about to send, which is the honest reading: we can see what we listed, we
    // cannot see whether this particular client also permits calling unlisted names.
    // False here therefore means "not demonstrably reachable", and it is the safe
    // direction — it withholds the licence to delete rather than granting it.
    const listedNames = new Set(LISTED_TOOLS.map(t => t.name));
    noteProbeArmed({
      hostCanReachUnlisted: [...HIDDEN_FULL_TOOL_NAMES].every(n => listedNames.has(n)),
    });
    send({
      jsonrpc: '2.0', id: req.id,
      result: {
        tools: LISTED_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: withFreshParam(t),
          // MCP tool annotations. `readOnlyHint` matters for real clients:
          // Cursor's Ask mode REFUSES to run any MCP tool that does not declare
          // it, so an unannotated read verb is simply unavailable there. The
          // field is purely additive — clients that don't know it ignore it.
          annotations: { readOnlyHint: !MUTATING_TOOLS.has(t.name) },
        })),
      },
    });
    return;
  }

  if (req.method === 'resources/list') {
    // Expose static briefs + overlay artifacts as MCP resources so clients
    // can auto-pull them at session start instead of requiring manual paste.
    // URIs are aify:// so there's no ambiguity with arbitrary file reads.
    const repoRoot = process.cwd();
    const aifyDir = path.join(repoRoot, '.aify-graph');
    const candidates = [
      { file: 'brief.agent.md',   name: 'Project brief (agent prompt substrate)',  desc: 'Dense key/value orientation. Paste into system/user prompt for orient-shaped sessions. ~300-700 tokens (size varies with public-API surface).', mime: 'text/markdown' },
      { file: 'brief.onboard.md', name: 'Project brief (onboarding variant)',      desc: 'Stripped brief for new-to-this-repo sessions. ~250 tokens.', mime: 'text/markdown' },
      { file: 'brief.plan.md',    name: 'Project brief (plan variant)',            desc: 'Features + open tasks by feature + feature-tagged recent commits + risks. For change-planning sessions. ~310 tokens.', mime: 'text/markdown' },
      { file: 'brief.md',         name: 'Project brief (human readable)',          desc: 'Full human-readable brief. ~500 tokens.', mime: 'text/markdown' },
      { file: 'brief.json',       name: 'Project brief (machine-readable)',        desc: 'JSON equivalent for scripts.', mime: 'application/json' },
      { file: 'functionality.json', name: 'Functionality overlay (L2)',            desc: 'User-curated feature map: features + symbol/file/route/doc anchors. Validated against code graph on each regen.', mime: 'application/json' },
      { file: 'tasks.json',       name: 'Task overlay (L3)',                       desc: 'External task tracker snapshot with feature attribution. Written by the graph-map-tasks skill.', mime: 'application/json' },
    ];
    const resources = [];
    for (const c of candidates) {
      const p = path.join(aifyDir, c.file);
      if (fs.existsSync(p)) {
        resources.push({
          uri: `aify://${c.file}`,
          name: c.name,
          description: c.desc,
          mimeType: c.mime,
        });
      }
    }
    send({ jsonrpc: '2.0', id: req.id, result: { resources } });
    return;
  }

  if (req.method === 'resources/read') {
    const { uri } = req.params || {};
    if (!uri || !uri.startsWith('aify://')) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `invalid resource uri: ${uri}` } });
      return;
    }
    const fileName = uri.slice('aify://'.length);
    // Whitelist the filenames we expose — never read arbitrary aify:// URIs.
    const allowed = new Set([
      'brief.agent.md', 'brief.onboard.md', 'brief.plan.md',
      'brief.md', 'brief.json',
      'functionality.json', 'tasks.json',
    ]);
    if (!allowed.has(fileName)) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `resource not exposed: ${fileName}` } });
      return;
    }
    const p = path.join(process.cwd(), '.aify-graph', fileName);
    if (!fs.existsSync(p)) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: `resource not found: ${fileName}. Run graph indexing + graph-brief.mjs first.` } });
      return;
    }
    try {
      const text = fs.readFileSync(p, 'utf8');
      const mime = fileName.endsWith('.json') ? 'application/json' : 'text/markdown';
      send({ jsonrpc: '2.0', id: req.id, result: { contents: [{ uri, mimeType: mime, text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: `failed to read ${fileName}: ${err.message}` } });
    }
    return;
  }

  if (req.method === 'tools/call') {
    // Guard against missing/non-object params — avoids unhandled rejection
    // when a malformed client sends tools/call without params. Found in
    // 2026-04-20 round-2 audit.
    const { name, arguments: args } = req.params || {};
    if (!name) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32602, message: 'Invalid params: missing tool name' } });
      return;
    }
    const tool = ACTIVE_TOOLS.find(t => t.name === name);
    if (!tool) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `unknown tool: ${name}` } });
      return;
    }


    // Plan #21 — sensitive-path gate. Refuse tool calls whose path-
    // shaped args (repo/repoRoot/projectRoot/file/files[]/etc.) resolve
    // under denylisted system or credential directories. Paths are
    // canonicalized via realpath before checking so symlinks can't
    // bypass. Returns a structured error envelope; caller sees the
    // exact arg name + reason so they can adjust the request.
    const sensitive = findSensitivePathArg(args);
    if (sensitive) {
      send({ jsonrpc: '2.0', id: req.id, error: {
        code: -32602,
        message: `Invalid params: argument '${sensitive.arg}' targets a sensitive path`,
        data: { arg: sensitive.arg, blockedPrefix: sensitive.matched, reason: sensitive.reason },
      }});
      return;
    }

    // ★ DELETION EVIDENCE — AFTER the sensitive-path gate, deliberately.
    //
    // This used to run before it. graph-senior-dev found that a hidden-verb call could
    // therefore write telemetry beneath a caller-supplied path that the very next check
    // was about to reject as sensitive: the catch stopped the append throwing outward, it
    // did not undo a successful unauthorised write. Telemetry must never be the thing
    // that touches a path the request is not yet allowed to touch.
    //
    // The sink has also moved out of the queried repo entirely, so this ordering is now
    // belt-and-braces rather than load-bearing — but the ordering is the part that would
    // be wrong again if the sink ever moved back.
    //
    // Still after tool resolution, so a typo'd name cannot forge a call record. Still
    // does not gate, warn, or change the response.
    noteDeprecatedVerbCall(name, args?.repoRoot ?? args?.repo ?? args?.projectRoot);

    try {
      let repoRoot = args?.repo ?? process.cwd();
      // P5-5: worktree redirect. If the server runs inside an ephemeral linked
      // git worktree that has no `.aify-graph` of its own, redirect graph
      // resolution to the MAIN working tree's root (where the durable graph
      // lives) so we neither serve a vanishing graph nor clobber the parent
      // checkout's. Only redirects when an explicit `repo` arg was NOT given
      // (an explicit path is authoritative). A one-line notice is prepended to
      // the verb output. Opt-out: APG_NO_WORKTREE_REDIRECT=1.
      let worktreeNotice = null;
      if (!args?.repo) {
        try {
          const { resolveGraphRoot } = await import('./freshness/git.js');
          const wt = resolveGraphRoot(repoRoot);
          if (wt.redirected) {
            worktreeNotice = `running in a git worktree (${repoRoot}); graph resolved from the main checkout at ${wt.root}.`;
            repoRoot = wt.root;
          } else if (wt.isWorktree) {
            worktreeNotice = `running in a git worktree (${repoRoot}); using this worktree's own .aify-graph (the main checkout's graph was not redirected).`;
          }
        } catch { /* best-effort — never block a verb on worktree detection */ }
      }
      // Loud, actionable error when the resolved repoRoot has no .aify-graph
      // AND no explicit repo arg was passed. Surfaced because the
      // 2026-04-26 echoes A/B test found agents silently retrying live
      // verbs 15+ times when the parent CC was launched from a non-repo
      // directory (e.g. home dir). Prevents the trust=missing retry storm.
      try {
        const { existsSync } = await import('node:fs');
        const path = await import('node:path');
        const graphDir = path.join(repoRoot, '.aify-graph');
        if (!args?.repo && !existsSync(graphDir)) {
          send({ jsonrpc: '2.0', id: req.id, result: {
            content: [{ type: 'text', text: [
              `ERROR: no .aify-graph in MCP cwd "${repoRoot}".`,
              ``,
              `The MCP server was launched from a directory that has no graph.`,
              `Two ways to fix:`,
              `  1. Pass repo="<absolute-path-to-target-repo>" in the tool args (works from any cwd).`,
              `  2. Restart Claude Code / Codex / OpenCode from inside the target repo`,
              `     so the MCP server's process.cwd() points at it.`,
              ``,
              `If the target repo has no graph yet, run /graph-build-all from it first.`,
            ].join('\n') }],
          } });
          return;
        }
      } catch { /* defensive: fall through to normal handler */ }
      // Normalize param names: accept both 'symbol' and 'node'/'from' for backwards compat
      const normalized = { ...args, repoRoot };
      if (args?.node && !args?.symbol) normalized.symbol = args.node;
      if (args?.from && !args?.symbol) normalized.symbol = args.from;
      // Clamp numeric params to safe ranges
      if (normalized.depth != null) normalized.depth = Math.min(Math.max(Number(normalized.depth) || 1, 1), 10);
      if (normalized.top_k != null) normalized.top_k = Math.min(Math.max(Number(normalized.top_k) || 10, 1), 200);
      if (normalized.limit != null) normalized.limit = Math.min(Math.max(Number(normalized.limit) || 20, 1), 100);
      // FRESHNESS IS A PER-QUESTION DECISION, NOT A PER-INSTALL ONE.
      //
      // Auto-reindex was env-only (APG_AUTO_REINDEX), which forced one answer on
      // every call. Both settings are genuinely defensible — ON never acts on stale
      // data but turns an arbitrary read into a minutes-long reindex; OFF keeps
      // reads cheap and staleness visible but lets an agent act on a stale graph if
      // it ignores the banner. Neither is right globally, because the right answer
      // depends on the QUESTION: "orient me in this repo" is fine on a snapshot,
      // "is it safe to delete this symbol" is not.
      //
      // So the caller can now decide per call with `fresh: true`, and the env var
      // remains the default for environments where the caller CANNOT decide —
      // managed workers that get read verbs but no graph_index.
      if (name !== 'graph_index' && name !== 'graph_status') {
        try {
          const { autoReindexEnabled } = await import('./freshness/auto-reindex.js');
          const perCall = normalized.fresh === true;
          if (perCall || autoReindexEnabled(process.env.APG_AUTO_REINDEX)) {
            const { getHeadCommit } = await import('./freshness/git.js');
            const { loadManifest } = await import('./freshness/manifest.js');
            const graphDir = path.join(repoRoot, '.aify-graph');
            const [{ manifest }, head] = await Promise.all([
              loadManifest(graphDir),
              getHeadCommit(repoRoot).catch(() => null),
            ]);
            if (manifest?.commit && head && manifest.commit !== head) {
              const { ensureFresh } = await import('./freshness/orchestrator.js');
              await ensureFresh({ repoRoot });
            }
          }
        } catch { /* best-effort: fall through, the post-handler warning still fires */ }
      }
      const result = await tool.handler(normalized);
      // Staleness warning: if graph is indexed but manifest commit lags HEAD,
      // surface a warning in the response so agents don't silently act on stale
      // data. Skip for graph_status / graph_index (they already show the facts).
      // Computed for every result type — previously gated on object-returning
      // verbs only, which let string-returning verbs (graph_change_plan,
      // graph_path, graph_packet) silently emit stale line numbers. Fix from
      // 2026-04-26 echoes A-v2 bench: agent nearly cited stale lines because
      // HEAD moved mid-run and string verbs gave no drift signal.
      let stalenessWarning = null;
      if (name !== 'graph_status' && name !== 'graph_index') {
        try {
          const { getHeadCommit } = await import('./freshness/git.js');
          const { loadManifest } = await import('./freshness/manifest.js');
          const graphDir = path.join(repoRoot, '.aify-graph');
          const [{ manifest }, head] = await Promise.all([
            loadManifest(graphDir),
            getHeadCommit(repoRoot).catch(() => null),
          ]);
          if (manifest?.commit && head && manifest.commit !== head) {
            const { commitsBehindHead } = await import('./query/verbs/read_freshness.js');
            const n = commitsBehindHead(repoRoot, manifest.commit, head);
            const behind = n != null ? ` (${n} commit${n === 1 ? '' : 's'} behind)` : '';
            stalenessWarning = `graph stale: indexed at ${manifest.commit.slice(0, 7)}, current HEAD is ${head.slice(0, 7)}${behind}. Run graph_index() to refresh, or set APG_AUTO_REINDEX=1 for auto-refresh — line numbers may drift.`;
          }
        } catch {
          // best-effort — never block a verb on staleness detection
        }
      }
      // ⛔ THE PROCESS-STALENESS CHANNEL WAS BUILT AND NEVER WIRED.
      //
      // `server-build.js` says of `staleProcessWarning()`: "A stale process makes EVERY answer
      // potentially wrong, so this does not belong only in graph_health — a reader who never
      // calls health would never learn." That is the intent. The effect was ONE consumer,
      // `read_freshness.js`. Every other verb said nothing, so an agent that opened a round with
      // graph_search or graph_packet got answers from old code with no signal at all — which is
      // why three of ef-manager's last four rounds opened blocked on it, and why they asked for
      // this three times.
      //
      // ⚠ NOTE THE TWO DIFFERENT STALENESSES. `stalenessWarning` above is the GRAPH lagging HEAD
      // — a data fact, per repo. This is the PROCESS running code from an older commit — a code
      // fact, and it applies to every repo this process serves. They are independent: either can
      // be true without the other, and conflating them is what made the first one's presence
      // feel like coverage.
      //
      // ⇒ Wired at the single choke point every verb returns through, so coverage is DERIVED
      // rather than a list of verbs somebody has to remember to extend.
      let processStaleWarning = null;
      try {
        const { staleProcessWarning } = await import('./server-build.js');
        // ⛔ NO VERB IS EXEMPT, INCLUDING graph_health — I tried to exempt it on the grounds that
        // it carries the full serverBuild block already, and the test caught that the grounds are
        // false: on a repo with NO GRAPH, health returns early with a three-field summary and
        // never reaches that block. So the one verb I had excused is the one that goes silent
        // exactly when somebody is diagnosing an unindexed repo.
        //
        // ⇒ The duplicate sentence on health's normal path is the cheaper mistake by a wide
        // margin. An exemption is a list of things somebody decided did not need the check, and
        // this file has spent the week learning what those cost.
        processStaleWarning = staleProcessWarning();
      } catch { /* best-effort — never block a verb on build introspection */ }

      // P5-5: fold the worktree notice into the same warning channel as the
      // staleness warning so read verbs surface it without a new field shape.
      const notices = [];
      // FIRST, because it invalidates the reading of everything under it: if the code that
      // produced this answer is not the code the reader thinks they are testing, the graph's
      // freshness is the less important of the two facts.
      if (processStaleWarning) notices.push(processStaleWarning);
      if (worktreeNotice) notices.push(worktreeNotice);
      if (stalenessWarning) notices.push(stalenessWarning);
      let text;
      if (typeof result === 'string') {
        const prefix = notices.map((n) => `WARNING: ${n}`).join('\n');
        text = prefix ? `${prefix}\n\n${result}` : result;
      } else {
        const wrapped = notices.length ? { _warnings: notices, ...result } : result;
        text = JSON.stringify(wrapped, null, 2);
      }
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      send({ jsonrpc: '2.0', id: req.id, result: { content: [{ type: 'text', text: `ERROR [${name}]: ${err.message}` }], isError: true } });
    }
    return;
  }

  if (req.id != null) {
    send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `method not found: ${req.method}` } });
  }
});

// ── Server lifecycle / shutdown ────────────────────────────────────────────
//
// Audit 2026-06-12 (3 agents, mirrors codegraph 0b1a2ee): the only wired event
// used to be rl.on('line'). With no stdin close/error or signal handling, when
// the MCP host closed stdin (the standard stdio shutdown signal) live LSP
// SESSIONS (spawned clangd/tsserver/pyright children) kept the event loop alive
// — the server lingered and leaked language-server children on every host exit.
//
// On stdin CLOSE we only TEAR DOWN the long-lived LSP children (which is what
// pins the loop) and then let Node exit NATURALLY once any in-flight verb
// handlers have written their replies. We must NOT process.exit() here: the
// line handler is async, so a hard exit on close would race mid-flight handlers
// and truncate their stdout responses (and process.exit can drop buffered pipe
// writes). A broken stdin/stdout pipe or a signal, by contrast, means the host
// is already gone and we cannot drain/reply — there we exit after best-effort
// teardown so we neither linger nor crash on a dead pipe.
let shuttingDown = false;
async function teardownSessions() {
  try { await shutdownAllSessions(); } catch { /* best-effort teardown */ }
  // ⛔ AN HTTP LISTENER PINS THE LOOP HARDER THAN AN LSP CHILD, and it was never torn down.
  //
  // graph-senior-dev-hermes, consumer-visible probe: boot the server, call graph_dashboard
  // (succeeds, real URL), close stdin, wait 5s — THE PROCESS DOES NOT EXIT. They had to
  // kill it. I had added stopAllDashboards() and a test for it, and wired it to NOTHING:
  // zero production consumers. The leak I correctly promoted from a test problem to a
  // production one was still entirely present.
  //
  // ★ The comment above already states the principle for LSP children — "with no stdin
  // close handling, live sessions kept the event loop alive". A listening socket is the
  // same fact with more force. Writing the shutdown function is not wiring it.
  try { await stopAllDashboards(); } catch { /* best-effort teardown */ }
}
async function gracefulExit(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  await teardownSessions();
  process.exit(code);
}
rl.on('close', () => { teardownSessions(); });
process.stdin.on('error', () => { gracefulExit(0); });
process.stdout.on('error', () => { gracefulExit(0); });
process.on('SIGINT', () => { gracefulExit(0); });
process.on('SIGTERM', () => { gracefulExit(0); });
// Borrow (codegraph #855): a truly-unexpected error must EXIT cleanly (after
// tearing down LSP children), not orphan/spin the process at 100% CPU. Verb
// handlers already catch their own errors and return isError; these are the
// last-resort net for everything else. Note them on stderr first.
process.on('uncaughtException', (err) => {
  try { process.stderr.write(`[aify-project-graph] uncaughtException: ${err?.stack ?? err}\n`); } catch { /* ignore */ }
  gracefulExit(1);
});
process.on('unhandledRejection', (reason) => {
  try { process.stderr.write(`[aify-project-graph] unhandledRejection: ${reason?.stack ?? reason}\n`); } catch { /* ignore */ }
  gracefulExit(1);
});
