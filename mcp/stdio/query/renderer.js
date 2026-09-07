// Output mode resolution. Precedence:
//   1. explicit `compact` flag passed to a render call
//   2. env var AIFY_GRAPH_OUTPUT=compact|verbose
//   3. default = verbose (backward-compatible)
//
// Compact mode strips repeated symbols, `EDGE`/arrow noise, and default
// confidence values. Target: 25-50% fewer tokens on impact/callers/path
// without losing information the caller actually needs.
function defaultCompactFromEnv() {
  const envMode = (process.env.AIFY_GRAPH_OUTPUT || '').toLowerCase();
  return envMode === 'compact';
}

function useCompact(opts) {
  if (opts && typeof opts.compact === 'boolean') return opts.compact;
  return defaultCompactFromEnv();
}

function formatLocation(filePath, line) {
  if (filePath === 'external') return 'external';
  if (filePath && filePath.length > 0) return `${filePath}:${line ?? 0}`;
  return 'external';
}

export function renderNodeLine(n) {
  return `NODE ${n.id} ${(n.type ?? 'unknown').toLowerCase()} ${n.label} ${formatLocation(n.file_path, n.start_line)}`;
}

// Provenance tag: only show when NOT the default EXTRACTED (the AST case).
// INFERRED / AMBIGUOUS are the signals worth surfacing — they tell agents
// "this edge came from heuristic resolution or framework synthesis, treat
// it with less trust." EXTRACTED stays silent to keep output terse.
//
// LSP_VERIFIED (Code-Intel v2 / L2b) is clangd ground truth and must NEVER
// render as equal to a heuristic edge. It gets a distinct, always-on inline
// marker `[lsp✓]` so an agent can tell verified edges from heuristic ones at
// a glance — even in compact mode, where EXTRACTED is silenced for terseness.
const LSP_VERIFIED_MARKER = '[lsp✓]';
export function renderProvenanceTag(p) {
  if (!p || p === 'EXTRACTED') return '';
  if (p === 'LSP_VERIFIED') return ` ${LSP_VERIFIED_MARKER}`;
  return ` prov=${p}`;
}

// Verbose edge line (original format, preserved for backward compat).
function renderEdgeVerbose(e) {
  const conf = ` conf=${Number(e.confidence ?? 1.0).toFixed(2)}`;
  const prov = renderProvenanceTag(e.provenance);
  const fromRef = e.from_label ?? e.from_id;
  const toRef = e.to_label ?? e.to_id;
  return `EDGE ${fromRef}→${toRef} ${e.relation} ${e.source_file ?? '?'}:${e.source_line ?? '?'}${conf}${prov}`;
}

// Compact edge line: `<caller_file>:<caller_line> <from_label> <rel> <to_label>`.
// Direction is explicit (from → rel → to), caller location leads for quick
// navigation. Drops `EDGE` prefix, drops `→` arrow noise, drops default
// confidence. ~35-45% shorter than verbose while staying unambiguous.
// If `to_label` is unavailable we omit it (query context supplies it).
function renderEdgeCompact(e) {
  const loc = `${e.source_file ?? '?'}:${e.source_line ?? '?'}`;
  const from = e.from_label ?? e.from_id ?? '?';
  const to = e.to_label ? ` ${e.to_label}` : '';
  const conf = Number(e.confidence ?? 1.0);
  const confTag = conf < 0.75 ? ` conf=${conf.toFixed(2)}` : '';
  const provTag = renderProvenanceTag(e.provenance);
  return `${loc} ${from} ${e.relation}${to}${confTag}${provTag}`;
}

export function renderEdgeLine(e, opts) {
  return useCompact(opts) ? renderEdgeCompact(e) : renderEdgeVerbose(e);
}

/**
 * ⛔ THE REMAINDER IS ONLY A NUMBER IF THE SET IT WAS SUBTRACTED FROM WAS COMPLETE.
 *
 * `truncated` is display budget: how many rows the renderer dropped to fit `top_k`. It is computed
 * as (rows the verb held) − (rows shown). When the verb's own FETCH saturated at a cap, the rows it
 * held are themselves a floor, so the remainder is a floor too and "TRUNCATED 70 more" states a
 * total the query never established.
 *
 * ⭐ FOUND 2026-09-07 BY DRIVING THE REAL VERB, not by reading it. `graph_impact` on a fan-in of
 * 101 printed 30 rows and "TRUNCATED 70 more" — implying exactly 100 — with no confidence line at
 * all, because the floor language shipped that morning sits behind `if (suspicious)` and this
 * symbol was not suspicious. The fix went into the line that sometimes prints and not the line that
 * always does. `graph_callers` had the identical hole; one owner, so it is repaired once.
 *
 * ⛔⛔ AND THE FLAG IS REQUIRED, NOT DEFAULTED — because the first version of this fix defaulted it
 * to `false` and an outside reviewer named that as the defect wearing the shape of a fix. A default
 * makes the repair OPT-IN PER VERB: seven verbs call this, and the two I had in mind when I wrote
 * "both verbs" were the two I happened to be editing. `callees` and `neighbors` would have kept the
 * old behaviour silently, and `callees` is the direct mirror of the verb I had just fixed.
 *
 * ⭐ DERIVE ALLOWED VALUES, NEVER LIST THEM — and where a value cannot be derived here, refuse
 * instead of guessing. A remainder is only a number if the set it was subtracted from was complete,
 * so a caller that reports a remainder must state whether that set was. Callers that report no
 * remainder never have to answer, which is why this does not become noise at the other five sites.
 *
 * @param {boolean} truncatedIsFloor  did the verb's fetch saturate, making the remainder a floor.
 *                                    REQUIRED whenever `truncated > 0`.
 */
export function renderCompact(
  { nodes = [], edges = [], truncated = 0, suggestion = '', truncatedIsFloor },
  opts,
) {
  const lines = [];
  for (const n of nodes) lines.push(renderNodeLine(n));
  for (const e of edges) lines.push(renderEdgeLine(e, opts));
  if (truncated > 0) {
    if (typeof truncatedIsFloor !== 'boolean') {
      throw new TypeError(
        'renderCompact: reporting a remainder of ' + truncated + ' requires truncatedIsFloor. '
        + 'A remainder is only a number if the fetch that produced it did not saturate — pass '
        + 'true when the query hit its cap, false when it did not. Guessing here is how a cap '
        + 'gets printed as a total.',
      );
    }
    const hint = suggestion ? ` (use ${suggestion})` : '';
    const count = truncatedIsFloor ? `at least ${truncated}` : `${truncated}`;
    const marker = useCompact(opts) ? `+${count} more` : `TRUNCATED ${count} more`;
    lines.push(`${marker}${hint}`);
  }
  return lines.join('\n');
}

// Verbose path: nested tree with indentation and per-row confidence.
function renderPathVerbose(paths, indent = 0) {
  const lines = [];
  for (const p of paths) {
    const provTag = indent === 0 ? '' : renderProvenanceTag(p.provenance);
    const prefix = indent === 0
      ? `PATH ${p.symbol} ${formatLocation(p.file, p.line)}`
      : `${'  '.repeat(indent)}→ ${p.symbol} ${formatLocation(p.file, p.line)} conf=${Number(p.confidence).toFixed(2)}${provTag}`;
    lines.push(prefix);
    if (p.children && p.children.length > 0) {
      lines.push(renderPathVerbose(p.children, indent + 1));
    }
  }
  return lines.join('\n');
}

// Compact path: preserve tree structure (essential for understanding
// branching) but drop `→` arrow noise and default-confidence tags.
// Flattening-to-chains was worse because deep branching trees repeat the
// shared prefix in every chain. Structure-preserving compaction is ~15-25%
// smaller than verbose without losing the branching signal.
function renderPathCompact(paths, indent = 0) {
  const lines = [];
  for (const p of paths) {
    const conf = Number(p.confidence ?? 1.0);
    // Only show confidence when it's genuinely low (< 0.75). Most resolved
    // edges sit at 0.90 and surfacing that on every row is pure noise.
    const confTag = conf < 0.75 ? ` conf=${conf.toFixed(2)}` : '';
    const provTag = indent === 0 ? '' : renderProvenanceTag(p.provenance);
    const prefix = indent === 0
      ? `PATH ${p.symbol} ${formatLocation(p.file, p.line)}`
      : `${'  '.repeat(indent)}${p.symbol} ${formatLocation(p.file, p.line)}${confTag}${provTag}`;
    lines.push(prefix);
    if (p.children && p.children.length > 0) {
      lines.push(renderPathCompact(p.children, indent + 1));
    }
  }
  return lines.join('\n');
}

export function renderPath(paths, indentOrOpts = 0) {
  const opts = typeof indentOrOpts === 'object'
    ? indentOrOpts
    : { compact: defaultCompactFromEnv() };
  const indent = typeof indentOrOpts === 'number' ? indentOrOpts : 0;
  if (useCompact(opts)) return renderPathCompact(paths);
  return renderPathVerbose(paths, indent);
}
