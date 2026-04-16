export function renderNodeLine(n) {
  return `NODE ${n.id} ${(n.type ?? 'unknown').toLowerCase()} ${n.label} ${n.file_path}:${n.start_line}`;
}

export function renderEdgeLine(e) {
  const conf = ` conf=${Number(e.confidence ?? 1.0).toFixed(2)}`;
  const fromRef = e.from_label ?? e.from_id;
  const toRef = e.to_label ?? e.to_id;
  return `EDGE ${fromRef}→${toRef} ${e.relation} ${e.source_file ?? '?'}:${e.source_line ?? '?'}${conf}`;
}

export function renderCompact({ nodes = [], edges = [], truncated = 0, suggestion = '' }) {
  const lines = [];
  for (const n of nodes) lines.push(renderNodeLine(n));
  for (const e of edges) lines.push(renderEdgeLine(e));
  if (truncated > 0) {
    const hint = suggestion ? ` (use ${suggestion})` : '';
    lines.push(`TRUNCATED ${truncated} more${hint}`);
  }
  return lines.join('\n');
}

export function renderPath(paths, indent = 0) {
  const lines = [];
  for (const p of paths) {
    const prefix = indent === 0
      ? `PATH ${p.symbol} ${p.file}:${p.line}`
      : `${'  '.repeat(indent)}→ ${p.symbol} ${p.file}:${p.line} conf=${Number(p.confidence).toFixed(2)}`;
    lines.push(prefix);
    if (p.children && p.children.length > 0) {
      lines.push(renderPath(p.children, indent + 1));
    }
  }
  return lines.join('\n');
}
