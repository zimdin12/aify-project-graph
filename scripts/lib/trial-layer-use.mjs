// DID A TRIAL RUN USE THE AUTHORED LAYER? Counted from the run's transcript, by resolving each dashboard tool call to
// the authored nodes it named or got back. (aify-dashboard docs/PREREGISTRATION-v0.8.md, "How each manipulation check
// is OBSERVED", check 1.)
//
// ⛔ NODE IDS ARE READ FROM STRUCTURE, NEVER SEARCHED FOR IN TEXT. The layer's feature ids include plain words
// (`dashboard`, `briefs`, `doc-layer`), and every dashboard reply says "dashboard". A text search would count every
// call as a use of the layer, and every run as treated.
//
// The authored ids are DERIVED from the feature map with the import's own rule (aify-dashboard 91fd94d,
// docs/evidence/usefulness-trial-2026-10-02/import.mjs), so this needs no answer from the service to know them; that
// the service holds exactly these is a separate check (`compareWithService`).
import { createHash } from 'node:crypto';

/** The node ids the import builds from a feature map. PURE. Mirrors import.mjs line for line. */
export function authoredNodeIds(map) {
  const codeId = (key) => `c${createHash('sha256').update(key).digest('hex').slice(0, 12)}`;
  const ids = new Set();
  for (const feature of map.features) {
    ids.add(feature.id);
    for (const key of Object.keys(feature.confirmed?.symbols ?? {})) ids.add(codeId(`symbol:${key}`));
    for (const path of [...(feature.anchors?.files ?? []), ...(feature.anchors?.docs ?? [])]) ids.add(codeId(`file:${path}`));
  }
  return ids;
}

/** A dashboard tool, as an MCP host names it: `mcp__<server>__dashboard_<verb>`, or the bare verb. */
export const isDashboardTool = (name) => /(^|__)dashboard_[a-z_]+$/u.test(String(name));

// The input fields that name ONE node: query's `from`, a route's ends, a mark's `target`.
const NODE_FIELDS = new Set(['from', 'target', 'a', 'b']);

/** Authored ids an input names: a node field equal to one, or an idPrefix that selects at least one. PURE. */
export function idsNamedInInput(input, ids) {
  const named = new Set();
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (NODE_FIELDS.has(key) && ids.has(value)) named.add(value);
      if (key === 'idPrefix') for (const id of ids) if (id.startsWith(value)) named.add(id);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(input, null);
  return named;
}

/** Authored ids a result returns: any object whose `id`, `from` or `to` is one. PURE. */
export function idsInResult(parsed, ids) {
  const found = new Set();
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      for (const key of ['id', 'from', 'to']) if (typeof value[key] === 'string' && ids.has(value[key])) found.add(value[key]);
      Object.values(value).forEach(walk);
    }
  };
  walk(parsed);
  return found;
}

const resultText = (content) => (typeof content === 'string'
  ? content
  : (Array.isArray(content) ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('') : null));

// ⛔ A LARGE RESULT NEVER REACHES THE AGENT. Claude Code saves a result over its inline limit to a file and puts a
// pointer and a 2 KB preview in the transcript instead (measured 2026-10-02: dashboard_graph_get on the 94-node
// `features` graph is 55.3 KB, and its preview holds the graph's header and not one node id). The call was against
// the layer; the layer did not reach the agent unless it then read the file.
const PERSISTED = /^<persisted-output>[\s\S]*?Full output saved to: (.+?)\s*$/mu;

/**
 * Every dashboard call in a run and what it touched, or a refusal. PURE apart from `readPersisted`, which the caller
 * supplies to read a saved result by its path (and returns null when it is gone).
 *
 * Two counts, because they come apart:
 * - `layerCalls`: calls against authored nodes, the preregistration's wording. A call counts when it did not fail and
 *   its input names an authored node or its full result returns one, read from the saved file when it was saved.
 * - `seenCalls`: of those, the ones whose authored nodes were in what the agent was shown: the inline result, or a
 *   saved result the agent later opened with Read.
 *
 * @param {{ records: object[], ids: Set<string>, readPersisted: (path: string) => string|null }} input
 *   `records` is every record of the run, session and subagent files.
 */
export function countLayerUse({ records, ids, readPersisted }) {
  if (!(ids instanceof Set) || ids.size === 0) return { ok: false, reason: 'no_authored_ids', detail: 'nothing to resolve calls against' };
  const uses = new Map();
  const results = new Map();
  const reads = [];
  for (const r of records) {
    for (const item of Array.isArray(r?.message?.content) ? r.message.content : []) {
      if (item?.type === 'tool_use' && isDashboardTool(item.name)) uses.set(item.id, item);
      if (item?.type === 'tool_use' && item.name === 'Read' && typeof item.input?.file_path === 'string') reads.push(item.input.file_path);
      if (item?.type === 'tool_result') results.set(item.tool_use_id, item);
    }
  }
  const samePath = (a, b) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();
  const calls = [];
  for (const [id, use] of uses) {
    const result = results.get(id);
    if (result === undefined) return { ok: false, reason: 'call_without_result', detail: id };
    const isError = result.is_error === true;
    let text = resultText(result.content);
    const saved = typeof text === 'string' ? text.match(PERSISTED) : null;
    let shown = !saved;
    if (saved) {
      const file = readPersisted(saved[1]);
      if (file === null) return { ok: false, reason: 'persisted_result_missing', detail: saved[1] };
      try { text = resultText(JSON.parse(file)); } catch { return { ok: false, reason: 'unparseable_result', detail: saved[1] }; }
      shown = reads.some((p) => samePath(p, saved[1]));
    }
    let parsed = null;
    if (!isError) {
      try { parsed = JSON.parse(text); } catch {
        return { ok: false, reason: 'unparseable_result', detail: `${use.name} ${id}` };
      }
    }
    const named = idsNamedInInput(use.input, ids);
    const returned = parsed === null ? new Set() : idsInResult(parsed, ids);
    // An errored call used nothing, whatever it asked for.
    const touched = isError ? [] : [...new Set([...named, ...returned])].sort();
    calls.push({ toolUseId: id, tool: use.name, isError, persisted: Boolean(saved), shown, named: [...named].sort(), returned: returned.size, touched });
  }
  const layer = calls.filter((c) => c.touched.length > 0);
  const seen = layer.filter((c) => c.shown);
  return {
    ok: true,
    dashboardCalls: calls.length,
    layerCalls: layer.length,
    seenCalls: seen.length,
    nodesTouched: [...new Set(layer.flatMap((c) => c.touched))].sort(),
    nodesSeen: [...new Set(seen.flatMap((c) => c.touched))].sort(),
    calls,
  };
}
