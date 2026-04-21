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
function renderProvenanceTag(p) {
  if (!p || p === 'EXTRACTED') return '';
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

export function renderCompact({ nodes = [], edges = [], truncated = 0, suggestion = '' }, opts) {
  const lines = [];
  for (const n of nodes) lines.push(renderNodeLine(n));
  for (const e of edges) lines.push(renderEdgeLine(e, opts));
  if (truncated > 0) {
    const hint = suggestion ? ` (use ${suggestion})` : '';
    const marker = useCompact(opts) ? `+${truncated} more` : `TRUNCATED ${truncated} more`;
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
