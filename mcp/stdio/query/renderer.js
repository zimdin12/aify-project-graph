export function renderNodeLine(n) {
  return `NODE ${n.id} ${n.type.toLowerCase()} ${n.label} ${n.file_path}:${n.start_line}`;
}

export function renderEdgeLine(e) {
  const conf = e.confidence != null ? ` conf=${Number(e.confidence).toFixed(2)}` : '';
  return `EDGE ${e.from_id}→${e.to_id} ${e.relation} ${e.source_file}:${e.source_line}${conf}`;
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
