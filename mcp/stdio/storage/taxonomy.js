// ───────────────────────────────────────────────────────────────────────────
// taxonomy.js — the SINGLE source of truth for the graph's data model.
//
// Before this file every verb re-declared its own relation slice
// (EXECUTION_RELATIONS in callers.js/callees.js, IMPACT_RELATIONS in impact.js,
// ALL_RELATIONS in neighbors.js, CALL_FAMILY_RELATIONS / IMPORT_RELATIONS in
// analytics.js, MODE_RELATIONS in path.js, a hardcoded list in pull.js). They
// overlapped inconsistently and let new edge types (OVERRIDDEN_BY, LOADS_SHADER,
// DECLARES_BINDING, HAS_DIAGNOSTIC) go unwired — invisible to graph_neighbors.
// This registry is the authority; every consumer imports from here and must not
// re-declare a local relation list. (Cohesion review R2.)
//
// ── NODE TYPES ──────────────────────────────────────────────────────────────
// The canonical node types the graph actually contains. Two sources compose:
//   • schema/structural types (tree-sitter + generic extractor + overlay):
//       Repository, File, Module, Directory, Document, Config, Route,
//       Entrypoint, Schema, Function, Method, Class, Interface, Type,
//       Variable, Symbol, Test, External
//   • code-intel / framework types actually emitted by extractors:
//       ShaderBinding (shader_bindings.js — glsl descriptor-set bindings; the
//                      cpp descriptor-write stash also reuses this type, scoped
//                      by language — see analytics count-scope note below)
// NOTE: there is deliberately NO `Struct` type. cpp.js maps struct_specifier →
// Class, so no extractor ever emits 'Struct'; consumer filters that listed it
// were dead and have been dropped (review R2 "phantom Struct").
//
// ── RELATIONS ───────────────────────────────────────────────────────────────
// Every relation a verb may traverse, grouped by what it means:
//   Containment / definition:  CONTAINS, DEFINES, DECLARES, EXPORTS
//   Execution (call graph):    CALLS, INVOKES, PASSES_THROUGH
//   Reference / type use:      REFERENCES, USES_TYPE
//   Inheritance / dispatch:    EXTENDS, IMPLEMENTS, OVERRIDDEN_BY
//   Module / file deps:        IMPORTS, INCLUDES, DEPENDS_ON, CONFIGURES
//   Test linkage:              TESTS
//   Docs:                      MENTIONS
//   Shader bridge (L5):        LOADS_SHADER, DECLARES_BINDING
//   Diagnostics (clangd):      HAS_DIAGNOSTIC
//
// ── FAMILIES ────────────────────────────────────────────────────────────────
// Named unions a verb traverses. Each is a subset of RELATIONS:
//   EXECUTION_FAMILY  — strict call graph: CALLS/INVOKES/PASSES_THROUGH.
//                       graph_callers / graph_callees walk exactly this.
//   CALL_FAMILY       — execution + REFERENCES. The "who touches this symbol"
//                       set (also used by pull's symbol/feature relations).
//   IMPACT_FAMILY     — CALL_FAMILY + USES_TYPE + TESTS + OVERRIDDEN_BY. The
//                       blast-radius set: a change ripples through callers,
//                       type users, tests, and virtual overrides.
//   IMPORT_FAMILY     — IMPORTS/INCLUDES + LOADS_SHADER. File-level "A depends
//                       on / pulls in B", including the shader bridge.
//   INHERITANCE_FAMILY— EXTENDS/IMPLEMENTS/OVERRIDDEN_BY. The type hierarchy.
//   BRIDGE_FAMILY     — LOADS_SHADER/DECLARES_BINDING. The cpp↔shader L5 bridge.
//   NEIGHBOR_FAMILY   — every relation graph_neighbors exposes (the general
//                       neighborhood verb; now INCLUDES the new edge types).
//
// Reconciliations applied (review R2 asked to make these consistent):
//   • USES_TYPE belongs to IMPACT (blast radius) — NOT to the strict execution
//     traversal of callers/callees. Those stay CALLS/INVOKES/PASSES_THROUGH.
//   • REFERENCES is part of CALL_FAMILY/IMPACT but not strict EXECUTION.
//   • OVERRIDDEN_BY is in IMPACT_FAMILY (callers/callees handle it via a
//     separate explicit forward query, kept as-is) and INHERITANCE_FAMILY.
//
// ── PROVENANCE LADDER ───────────────────────────────────────────────────────
// EDGE_PROVENANCE_TYPES, weakest → strongest, is an ORDERED ladder. A single
// rank/render/trust interpretation point reads it; this is the authority for
// the CODE_INTEL-vs-LSP_VERIFIED precedence rule (previously documented only in
// scattered comments in importer.js / edges.js):
//   EXTRACTED    — tree-sitter structural extraction (default). Heuristic.
//   INFERRED     — framework/heuristic synthesis (virtual overrides, resolver
//                  guesses). Heuristic, best-effort, may over/under-claim.
//   AMBIGUOUS    — extracted but the resolver could not disambiguate the target.
//   CODE_INTEL   — emitted by a real code-intel collection (clangd v0.1 path /
//                  symbol & definition records). Authoritative for its own
//                  edges. PRECEDENCE: an LSP_VERIFIED synthesizer NEVER
//                  downgrades a CODE_INTEL edge (the upsert WHERE clause excludes
//                  provenance='CODE_INTEL' — see edges.js CODE_INTEL_OVERRIDE_SQL
//                  and importer.js LSP_EDGE_OVERRIDE_SQL).
//   LSP_VERIFIED — clangd v0.2 ground-truth CALLS edges. PROMOTES weaker edges
//                  (EXTRACTED/INFERRED/AMBIGUOUS) in place — stashing their
//                  origin so re-collect can restore them (C1) — but NEVER
//                  downgrades CODE_INTEL. Strongest tier; render layers rank it
//                  above all heuristics.
// ───────────────────────────────────────────────────────────────────────────

// ── Node types ──────────────────────────────────────────────────────────────
export const NODE_TYPES = Object.freeze([
  // structural / schema
  'Repository', 'File', 'Module', 'Directory', 'Document', 'Config',
  'Route', 'Entrypoint', 'Schema',
  'Function', 'Method', 'Class', 'Interface', 'Type', 'Variable',
  'Symbol', 'Test', 'External',
  // framework / code-intel
  'ShaderBinding',
]);

// ── Relations (every relation actually used in the graph) ────────────────────
export const RELATIONS = Object.freeze([
  // containment / definition
  'CONTAINS', 'DEFINES', 'DECLARES', 'EXPORTS',
  // execution (call graph)
  'CALLS', 'INVOKES', 'PASSES_THROUGH',
  // reference / type use
  'REFERENCES', 'USES_TYPE',
  // inheritance / dispatch
  'EXTENDS', 'IMPLEMENTS', 'OVERRIDDEN_BY',
  // module / file deps
  'IMPORTS', 'INCLUDES', 'DEPENDS_ON', 'CONFIGURES',
  // test linkage
  'TESTS',
  // docs
  'MENTIONS',
  // shader bridge (L5)
  'LOADS_SHADER', 'DECLARES_BINDING',
  // diagnostics
  'HAS_DIAGNOSTIC',
]);

const RELATION_SET = new Set(RELATIONS);

// ── Families (named unions; each a subset of RELATIONS) ──────────────────────

// Strict call graph — graph_callers / graph_callees forward+backward walks.
// (Was EXECUTION_RELATIONS, duplicated in callers.js and callees.js.)
export const EXECUTION_FAMILY = Object.freeze(['CALLS', 'INVOKES', 'PASSES_THROUGH']);

// Execution + REFERENCES — "who touches this symbol". Used by pull's
// symbol/feature relation rollups.
export const CALL_FAMILY = Object.freeze([...EXECUTION_FAMILY, 'REFERENCES']);

// Blast radius — call family + type users + tests + virtual overrides.
// (Was IMPACT_RELATIONS; USES_TYPE/TESTS reconciled to live here, plus
// OVERRIDDEN_BY so the family is complete even though impact.js queries the
// forward override edges separately.)
export const IMPACT_FAMILY = Object.freeze([
  ...CALL_FAMILY, 'USES_TYPE', 'TESTS', 'OVERRIDDEN_BY',
]);

// File-level "A imports / includes / loads B". (Was IMPORT_RELATIONS in
// analytics.js (IMPORTS/INCLUDES) + a hardcoded IMPORTS in pull.js; LOADS_SHADER
// folded in so the shader bridge counts as a dependency edge.)
export const IMPORT_FAMILY = Object.freeze(['IMPORTS', 'INCLUDES', 'LOADS_SHADER']);

// Type hierarchy / dynamic dispatch.
export const INHERITANCE_FAMILY = Object.freeze(['EXTENDS', 'IMPLEMENTS', 'OVERRIDDEN_BY']);

// cpp ↔ shader L5 bridge.
export const BRIDGE_FAMILY = Object.freeze(['LOADS_SHADER', 'DECLARES_BINDING']);

// Provenance-mix call family — the exact set whose EXTRACTED/INFERRED/
// CODE_INTEL/LSP_VERIFIED split is the analytics trust signal. (Was
// analytics.js CALL_FAMILY_RELATIONS.) Kept distinct from CALL_FAMILY because it
// intentionally includes USES_TYPE (a type-use is still a "touch" worth scoring
// for provenance) but excludes PASSES_THROUGH.
export const PROVENANCE_CALL_FAMILY = Object.freeze(['CALLS', 'REFERENCES', 'INVOKES', 'USES_TYPE']);

// graph_neighbors allowlist — every relation the general neighborhood verb
// exposes. NOW includes the new edge types (OVERRIDDEN_BY, LOADS_SHADER,
// DECLARES_BINDING, HAS_DIAGNOSTIC) so a user can see a symbol's overrides, a
// shader's bindings, and a file's diagnostics through one verb. (Was
// ALL_RELATIONS in neighbors.js, which omitted them — review R2 fix.)
export const NEIGHBOR_FAMILY = Object.freeze([...RELATIONS]);

// path.js traversal modes. execution = strict call graph; dependency adds the
// reference/test reach. (Was MODE_RELATIONS in path.js.)
export const PATH_MODE_FAMILIES = Object.freeze({
  execution: Object.freeze(['PASSES_THROUGH', 'INVOKES', 'CALLS']),
  dependency: Object.freeze(['PASSES_THROUGH', 'INVOKES', 'CALLS', 'TESTS', 'REFERENCES']),
});

// ── Provenance ladder (centralized from schema.js; this file is the authority).
export const EDGE_PROVENANCE_TYPES = Object.freeze([
  'EXTRACTED',
  'INFERRED',
  'AMBIGUOUS',
  'CODE_INTEL',
  'LSP_VERIFIED',
]);

// Rank for the ordered ladder (weakest 0 → strongest). Single interpretation
// point for "is A stronger than B" decisions.
export const PROVENANCE_RANK = Object.freeze(
  Object.fromEntries(EDGE_PROVENANCE_TYPES.map((p, i) => [p, i])),
);
