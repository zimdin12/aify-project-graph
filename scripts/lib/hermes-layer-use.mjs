// DID A HERMES RUN USE THE AUTHORED LAYER? The sibling of trial-layer-use.mjs (which reads a Claude Code transcript),
// for the rehearsal's Hermes arms. It reads the run's rows from state.db's `messages` table and resolves each
// dashboard call to authored nodes with the SAME functions, so the two runtimes count a layer call by one rule.
//
// What Hermes v0.21.5 writes, measured 2026-10-05 (session 20261005_075736_c79110) and read in its source:
// - An assistant row's `tool_calls` is a JSON list of `{id, function: {name, arguments}}`. An MCP tool that Hermes
//   defers behind tool search is called through the meta tool `tool_call`, whose arguments are
//   `{calls: [{name, arguments}]}`. agent/tool_call_batches.py splits a multi-entry batch into one call per entry
//   BEFORE it is persisted, except a malformed or connector-only batch. So a persisted `tool_call` holding more than one
//   entry cannot be mapped to its results, and is refused rather than guessed.
// - A tool row carries `tool_call_id` and the resolved tool name. MCP content is wrapped in
//   `<untrusted_tool_result …>`, a preamble, a blank line, then the handler's JSON: `{"result": "<text>", …}`, or
//   `{"error": "…"}` for a failed call (tools/registry.py tool_error).
// - ⛔ A LARGE RESULT NEVER REACHES THE AGENT, as in Claude Code: over 50,000 chars for an MCP tool
//   (tools/budget_config.py) it is spilled to a file and the row holds `<persisted-output>` with
//   `Full output saved to: <path>` and a 1,500-char preview. The file holds the envelope's `result` text, with any
//   sibling fields in a trailing `<mcp-result-metadata>` block. When no file could be written, the row holds the preview
//   and `[Truncated: …]`, and the full result exists nowhere: refused.
// - ⚠ Hermes prunes spill files after 24 hours (tools/tool_result_storage.py). Copy them when the run ends.
//
// "Seen" matches the Claude reader exactly: inline, or a saved result the agent later opened with its file reader
// (`read_file` here, `Read` there). A terminal `cat` of the file counts in NEITHER, deliberately, so that the two
// runtimes are counted alike.
import { idsInResult, idsNamedInInput, isDashboardTool } from './trial-layer-use.mjs';

const TOOL_CALL = 'tool_call';
const WRAPPED = /^<untrusted_tool_result[^>]*>\n[\s\S]*?\n\n([\s\S]*)\n<\/untrusted_tool_result>\s*$/u;
const PERSISTED = /^<persisted-output>[\s\S]*?^Full output saved to: (.+?)\s*$/mu;
const UNSAVED = /\[Truncated: tool response was [\d,]+ chars\. Full output could not be saved/u;
const METADATA = /\n\n<mcp-result-metadata>\n[\s\S]*\n<\/mcp-result-metadata>\n?$/u;
const ENVELOPE_KEYS = new Set(['result', 'structuredContent', '_meta']);

const parseJson = (text) => { try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; } };
const argsOf = (raw) => (typeof raw === 'string' ? parseJson(raw) : { ok: true, value: raw ?? {} });

/** The tool calls an assistant row makes, each as the tool actually run: `tool_call` unwrapped. PURE. */
export function callsInRow(row) {
  const listed = parseJson(row.tool_calls ?? '[]');
  if (!listed.ok || !Array.isArray(listed.value)) return { ok: false, reason: 'unparseable_tool_calls', detail: row.id };
  const calls = [];
  for (const call of listed.value) {
    const args = argsOf(call?.function?.arguments);
    if (!args.ok) return { ok: false, reason: 'unparseable_tool_calls', detail: call?.id };
    const ids = [...new Set([call.id, call.call_id].filter(Boolean))];
    if (call.function.name !== TOOL_CALL) { calls.push({ ids, name: call.function.name, input: args.value, via: 'direct' }); continue; }
    const entries = Array.isArray(args.value?.calls) ? args.value.calls : [];
    if (entries.length !== 1) return { ok: false, reason: 'unsplit_batch', detail: `${call.id}: ${entries.length} entries` };
    const inner = argsOf(entries[0].arguments);
    if (!inner.ok) return { ok: false, reason: 'unparseable_tool_calls', detail: call.id };
    calls.push({ ids, name: entries[0].name, input: inner.value, via: TOOL_CALL });
  }
  return { ok: true, calls };
}

/** A spilled file's text as the dashboard sent it: metadata block removed, an unrecognised envelope unwrapped. PURE. */
function spilledText(file) {
  const text = file.replace(METADATA, '');
  const parsed = parseJson(text);
  const envelope = parsed.ok && parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
    && Object.keys(parsed.value).length > 0 && Object.keys(parsed.value).every((k) => ENVELOPE_KEYS.has(k))
    && typeof parsed.value.result === 'string';
  return envelope ? parsed.value.result : text;
}

/**
 * What one tool row returned: an error, or the dashboard's parsed reply and whether it was saved to a file.
 * PURE apart from `readPersisted(path)`, which returns the saved file or null when it is gone.
 */
export function readToolResult(content, readPersisted) {
  const text = String(content ?? '');
  const payload = text.match(WRAPPED)?.[1] ?? text;
  if (UNSAVED.test(payload)) return { ok: false, reason: 'result_truncated_unsaved' };
  const saved = payload.match(PERSISTED);
  if (saved) {
    const file = readPersisted(saved[1]);
    if (file === null) return { ok: false, reason: 'persisted_result_missing', detail: saved[1] };
    const reply = parseJson(spilledText(file));
    return reply.ok ? { ok: true, isError: false, parsed: reply.value, persistedPath: saved[1] } : { ok: false, reason: 'unparseable_result', detail: saved[1] };
  }
  const handler = parseJson(payload);
  if (!handler.ok || !handler.value || typeof handler.value !== 'object') return { ok: false, reason: 'unparseable_result' };
  if ('error' in handler.value && !('result' in handler.value)) return { ok: true, isError: true, parsed: null, persistedPath: null };
  const { result } = handler.value;
  if (result && typeof result === 'object') return { ok: true, isError: false, parsed: result, persistedPath: null };
  const reply = parseJson(result);
  return reply.ok ? { ok: true, isError: false, parsed: reply.value, persistedPath: null } : { ok: false, reason: 'unparseable_result' };
}

const samePath = (a, b) => a.replaceAll('\\', '/').toLowerCase() === b.replaceAll('\\', '/').toLowerCase();

/**
 * Every dashboard call in a Hermes run and what it touched, or a refusal. Same counts and output shape as
 * countLayerUse: `layerCalls` (a call that did not fail and named or returned an authored node) and `seenCalls` (of
 * those, the ones whose nodes reached the agent).
 * @param {{ rows: object[], ids: Set<string>, readPersisted: (path: string) => string|null }} input
 *   `rows` is every `messages` row of the session, in id order.
 */
export function countHermesLayerUse({ rows, ids, readPersisted }) {
  if (!(ids instanceof Set) || ids.size === 0) return { ok: false, reason: 'no_authored_ids', detail: 'nothing to resolve calls against' };
  const uses = [];
  const reads = [];
  for (const row of rows.filter((r) => r.role === 'assistant' && r.tool_calls)) {
    const found = callsInRow(row);
    if (!found.ok) return found;
    for (const call of found.calls) {
      if (isDashboardTool(call.name)) uses.push(call);
      if (call.name === 'read_file' && typeof call.input?.path === 'string') reads.push(call.input.path);
    }
  }
  const results = new Map(rows.filter((r) => r.role === 'tool' && r.tool_call_id).map((r) => [r.tool_call_id, r]));
  const calls = [];
  for (const use of uses) {
    const row = use.ids.map((id) => results.get(id)).find(Boolean);
    if (!row) return { ok: false, reason: 'call_without_result', detail: use.ids[0] };
    const result = readToolResult(row.content, readPersisted);
    if (!result.ok) return { ...result, detail: result.detail ?? `${use.name} ${use.ids[0]}` };
    const shown = result.persistedPath === null || reads.some((p) => samePath(p, result.persistedPath));
    const named = idsNamedInInput(use.input, ids);
    const returned = result.parsed === null ? new Set() : idsInResult(result.parsed, ids);
    // An errored call used nothing, whatever it asked for.
    const touched = result.isError ? [] : [...new Set([...named, ...returned])].sort();
    calls.push({ toolUseId: use.ids[0], tool: use.name, via: use.via, isError: result.isError, persisted: result.persistedPath !== null, shown, named: [...named].sort(), returned: returned.size, touched });
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
