import { resolveSymbol } from './symbol_lookup.js';

function placeholders(values, prefix) {
  return {
    sql: values.map((_, index) => `$${prefix}${index}`).join(','),
    params: Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value])),
  };
}

export function expandClassRollupTargets(db, symbol) {
  // resolveSymbol handles class-qualified forms (C++ `Class::method`,
  // dotted `Class.method`) by falling back to the bare name and
  // disambiguating via extra.qname when the parent is named. Critical
  // for C++ where agents naturally ask `GpuSimFramework::setGravAxis`.
  const targets = resolveSymbol(db, symbol);
  if (targets.length === 0) {
    return { targets: [], targetIds: [], rolledUp: false, header: '', methodIds: [] };
  }

  const classTargets = targets.filter((target) => target.type === 'Class');
  if (classTargets.length === 0) {
    return {
      targets,
      targetIds: targets.map((target) => target.id),
      rolledUp: false,
      header: '',
      methodIds: [],
    };
  }

  const classIds = classTargets.map((target) => target.id);
  const { sql, params } = placeholders(classIds, 'class');
  const methods = db.all(
    `SELECT DISTINCT n.id
     FROM edges e
     JOIN nodes n ON n.id = e.to_id
     WHERE e.relation = 'CONTAINS'
       AND e.from_id IN (${sql})
       AND n.type = 'Method'`,
    params,
  );

  const methodIds = methods.map((row) => row.id);
  const targetIds = [...new Set([...classIds, ...methodIds])];
  const methodCount = methodIds.length;
  const classCount = classTargets.length;
  const label = classCount === 1 ? 'Class' : 'Classes';
  const header = `ROLLUP ${label} "${symbol}" across ${methodCount} method${methodCount === 1 ? '' : 's'}`;

  return { targets, targetIds, rolledUp: true, header, methodIds };
}

export function collapseCallerEdges(edges, rolledUpSymbol) {
  const grouped = new Map();

  for (const edge of edges) {
    const key = `${edge.from_id}:${edge.depth ?? 1}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...edge,
        fan_in: 1,
        to_label: rolledUpSymbol ?? edge.to_label,
      });
      continue;
    }

    existing.fan_in += 1;
    if ((edge.confidence ?? 0) > (existing.confidence ?? 0)) {
      existing.confidence = edge.confidence;
      existing.source_file = edge.source_file;
      existing.source_line = edge.source_line;
    }
  }

  return [...grouped.values()];
}
