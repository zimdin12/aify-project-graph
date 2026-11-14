// Answer the dashboard's `references` and `definitions` calls from the live code-intel handlers (#8 step 2).
//
//   args    { file, line, col, limit? }   file repository-relative; line and col 1-based; limit 1..1000 (100)
//   answer  references:  { file, position, observed, resultState, freshness, references, declarations,
//                          declarationSource, matched, withheld, truncated, evidence }
//           definitions: { file, position, observed, freshness, definitions, matched, withheld, truncated, evidence }
//   a location is { path, range: { start: { line, col }, end: { line, col } } | null, provenance }
//
// The language server itself is not started here. The caller passes `invoke`, which runs the existing
// codeIntelReferences / codeIntelDefinitions handler for one repository, and `guardPath`, which checks that the file
// RESOLVES inside that repository (symlinks, junctions). This file decides only what is asked and what is answered.
//
// ⛔ A PATH THAT COULD LEAVE THE REPOSITORY IS REFUSED BEFORE ANYTHING READS IT. The handler opens whatever path it
// is given (code_intel_live.js openIfNeeded), so the lexical check runs first and the resolved check second, and the
// language server is reached only past both.
//
// ⛔ A LOCATION OUTSIDE THE REPOSITORY IS WITHHELD AND COUNTED, decided from the path the handler returned. The
// handler marks outside references with `outsideRepo`, but its definitions call drops that mark (uriToRel), so the
// flag cannot be the test. It is still honoured in the withholding direction.
//
// ⛔ THE ANSWER READS THE WORKING TREE, NOT THE COMMIT. A language server sees uncommitted edits; stamp and resolve
// do not. The answer says so, and it never claims a complete set.

import { repoRelativeProblem } from './provider-paths.mjs';

const SHAPERS = Object.freeze({
  references: { shape: shapeReferences, locations: ['referenceLocations', 'definitionLocations'] },
  definitions: { shape: shapeDefinitions, locations: ['definitions'] },
});
/** The calls answered here, derived from the actual result adapters. */
export const LIVE_CALLS = Object.freeze(Object.keys(SHAPERS));

/** The agreed bound on how many locations one answer lists. */
export const LIVE_BOUNDS = Object.freeze({ limit: Object.freeze({ fallback: 100, max: 1000 }) });

/** How a live answer was computed, in this provider's own words. Travels as the answer's provenance. */
export const LIVE_HOW = 'apg live language server over the working tree, not the commit (locations are '
  + 'compiler-resolved; the set is a floor, never complete)';

/** The upstream error codes a reader may branch on. Anything else is reported as backend_error. */
const UPSTREAM_CODES = new Set([
  'invalid_request', 'language_unsupported', 'language_server_missing', 'unsupported_evidence_contract_version', 'internal_error',
]);

const ALLOWED_ARGS = new Set(['file', 'line', 'col', 'limit']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPosition = (v) => Number.isSafeInteger(v) && v >= 1;


/**
 * Validate `args`. Returns { ok: true, value } or { ok: false, problem, reasonCode }. Nothing sent wrong is defaulted.
 */
export function parseLiveArgs(args) {
  const refuse = (problem, reasonCode = 'invalid_request') => ({ ok: false, problem, reasonCode });
  if (!isPlainObject(args)) return refuse('args must be an object');
  const unknown = Object.keys(args).filter((k) => !ALLOWED_ARGS.has(k));
  if (unknown.length > 0) return refuse(`args.${unknown[0]} is not accepted: a live call takes only file, line, col and limit`);
  if (typeof args.file !== 'string' || args.file === '') return refuse('args.file must be a non-empty repository-relative path');
  const pathProblem = repoRelativeProblem(args.file);
  if (pathProblem !== null) return refuse(pathProblem, 'path_outside_repository');
  if (!isPosition(args.line)) return refuse('args.line must be an integer of 1 or more');
  if (!isPosition(args.col)) return refuse('args.col must be an integer of 1 or more');
  let limit = LIVE_BOUNDS.limit.fallback;
  if (args.limit !== undefined) {
    if (!Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > LIVE_BOUNDS.limit.max) {
      return refuse(`args.limit must be an integer from 1 to ${LIVE_BOUNDS.limit.max}`);
    }
    limit = args.limit;
  }
  return { ok: true, value: { file: args.file, line: args.line, col: args.col, limit } };
}

/**
 * Answer one live call.
 * @param call       'references' | 'definitions'
 * @param args       as claimed
 * @param repoRoot   the granted repository this request is for
 * @param guardPath  async ({ repoRoot, file }) => { ok: true } | { ok: false, problem, reasonCode }
 * @param invoke     async ({ call, repoRoot, file, line, col }) => the code_intel_live.js handler's result
 * @returns {{ ok: true, value } | { ok: false, problem, reasonCode }}
 */
export async function readLive({ call, args, repoRoot, guardPath, invoke }) {
  if (!LIVE_CALLS.includes(call)) {
    return { ok: false, problem: `${JSON.stringify(call)} is not a live call (live calls: ${LIVE_CALLS.join(', ')})`, reasonCode: 'invalid_request' };
  }
  const parsed = parseLiveArgs(args);
  if (!parsed.ok) return parsed;
  const { file, line, col, limit } = parsed.value;

  const guarded = await checkGuard(guardPath, { repoRoot, file });
  if (!guarded.ok) return guarded;

  let raw;
  try {
    raw = await invoke({ call, repoRoot, file, line, col });
  } catch (error) {
    return { ok: false, problem: `the language server call failed: ${error?.message ?? String(error)}`, reasonCode: 'backend_failed' };
  }
  const failed = upstreamFailure(raw);
  if (failed) return failed;
  const checked = await checkReturnedPaths({ raw, call, repoRoot, guardPath });
  if (!checked.ok) return checked;
  const shaped = SHAPERS[call].shape(checked.value, limit);
  if (!shaped) return { ok: false, problem: `the ${call} handler answered in a shape this provider does not know`, reasonCode: 'malformed_backend_answer' };
  return { ok: true, value: { file, position: { line, col }, observed: 'working_tree', ...shaped } };
}

/** The guard's verdict, failing closed on a missing guard, a throw, or an answer it cannot read. */
async function checkGuard(guardPath, request) {
  const unavailable = (why) => ({ ok: false, problem: `the repository path check could not run: ${why}`, reasonCode: 'path_guard_unavailable' });
  if (typeof guardPath !== 'function') return unavailable('no path check was supplied');
  let verdict;
  try { verdict = await guardPath(request); } catch (error) { return unavailable(error?.message ?? String(error)); }
  if (verdict?.ok === true) return { ok: true };
  if (verdict?.ok === false && typeof verdict.problem === 'string' && verdict.problem !== '') {
    return { ok: false, problem: verdict.problem, reasonCode: typeof verdict.reasonCode === 'string' && verdict.reasonCode !== '' ? verdict.reasonCode : 'path_outside_repository' };
  }
  return unavailable('the path check gave no verdict');
}

/** Resolve returned paths too: a lexically local location may be a junction into another repository. */
async function checkReturnedPaths({ raw, call, repoRoot, guardPath }) {
  const value = { ...raw };
  const keys = SHAPERS[call].locations;
  for (const key of keys) {
    if (!Array.isArray(raw[key])) continue; // the shaper reports malformed arrays below
    const entries = [];
    for (const entry of raw[key]) {
      if (!isPlainObject(entry) || entry.outsideRepo === true || repoRelativeProblem(entry.file) !== null) {
        entries.push(entry);
        continue;
      }
      const verdict = await checkGuard(guardPath, { repoRoot, file: entry.file });
      if (!verdict.ok && verdict.reasonCode !== 'path_outside_repository') return verdict;
      entries.push(verdict.ok ? entry : { ...entry, outsideRepo: true });
    }
    value[key] = entries;
  }
  return { ok: true, value };
}

/** The handler's own error answer as a refusal, a non-ok status as malformed, or null when it says ok. */
function upstreamFailure(raw) {
  if (!isPlainObject(raw)) return { ok: false, problem: 'the language server handler returned nothing usable', reasonCode: 'malformed_backend_answer' };
  if (raw.status === 'ok') return null;
  const first = raw.status === 'error' && Array.isArray(raw.errors) ? raw.errors[0] : undefined;
  if (!isPlainObject(first) || typeof first.message !== 'string') {
    return { ok: false, problem: `the language server handler answered status ${JSON.stringify(raw.status)} without a readable error`, reasonCode: 'malformed_backend_answer' };
  }
  const known = UPSTREAM_CODES.has(first.code);
  const hint = typeof first.hint === 'string' && first.hint !== '' ? ` (${first.hint})` : '';
  return {
    ok: false,
    problem: known ? `${first.message}${hint}` : `${String(first.code ?? 'error')}: ${first.message}${hint}`,
    reasonCode: known ? first.code : 'backend_error',
  };
}

function shapeReferences(raw, limit) {
  if (!Array.isArray(raw.referenceLocations) || !Array.isArray(raw.definitionLocations)) return null;
  const evidence = shapeEvidence(raw.evidence);
  const refs = splitByRepository(raw.referenceLocations);
  const decls = splitByRepository(raw.definitionLocations);
  if (!evidence || !refs || !decls) return null;
  return {
    resultState: typeof raw.result_state === 'string' ? raw.result_state : null,
    freshness: typeof raw.freshness === 'string' ? raw.freshness : null,
    references: refs.kept.slice(0, limit),
    declarations: decls.kept.slice(0, limit),
    declarationSource: typeof raw.definitionSource === 'string' ? raw.definitionSource : null,
    matched: { references: refs.kept.length, declarations: decls.kept.length },
    withheld: { outsideRepository: { references: refs.withheld, declarations: decls.withheld } },
    truncated: refs.kept.length > limit || decls.kept.length > limit,
    evidence,
  };
}

function shapeDefinitions(raw, limit) {
  if (!Array.isArray(raw.definitions)) return null;
  const evidence = shapeEvidence(raw.evidence);
  const defs = splitByRepository(raw.definitions);
  if (!evidence || !defs) return null;
  return {
    freshness: typeof raw.freshness === 'string' ? raw.freshness : null,
    definitions: defs.kept.slice(0, limit),
    matched: { definitions: defs.kept.length },
    withheld: { outsideRepository: { definitions: defs.withheld } },
    truncated: defs.kept.length > limit,
    evidence,
  };
}

/** The handler's locations, split into repository locations and a count of those withheld; null if one is unreadable. */
function splitByRepository(entries) {
  const kept = [];
  let withheld = 0;
  for (const entry of entries) {
    if (!isPlainObject(entry) || typeof entry.file !== 'string' || entry.file === '') return null;
    if (entry.range !== null && entry.range !== undefined && !isRange(entry.range)) return null;
    if (entry.outsideRepo === true || repoRelativeProblem(entry.file) !== null) { withheld += 1; continue; }
    kept.push({ path: entry.file, range: entry.range ?? null, provenance: typeof entry.provenance === 'string' ? entry.provenance : null });
  }
  return { kept, withheld };
}

const isPoint = (p) => isPlainObject(p) && isPosition(p.line) && isPosition(p.col);
const isRange = (r) => isPlainObject(r) && isPoint(r.start) && isPoint(r.end)
  && (r.end.line > r.start.line || (r.end.line === r.start.line && r.end.col >= r.start.col));

/**
 * Factual evidence fields, with `exhaustive` always false. Advice is rendered for this provider, not copied from
 * the retiring MCP verbs. The deprecated degraded booleans are left behind.
 */
function shapeEvidence(evidence) {
  if (!isPlainObject(evidence)) return null;
  const out = { exhaustive: false,
    fallback: 'Read the working-tree source and search the repository before making an absence, deletion or rename decision.' };
  for (const key of ['ready', 'cause', 'confidence', 'contractVersion', 'translationUnitFailed', 'previouslyDegraded']) {
    if (evidence[key] !== undefined) out[key] = evidence[key];
  }
  // Freeform upstream warnings/fallbacks recommend legacy-only options and can promise exhaustive results.
  // Preserve factual fields; the provider owns its own supported guidance above.
  if (Array.isArray(evidence.missingHeaders)) out.missingHeaders = evidence.missingHeaders.filter((h) => typeof h === 'string');
  return out;
}
