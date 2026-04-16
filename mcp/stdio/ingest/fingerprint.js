import { createHash } from 'node:crypto';

export function symbolFingerprints(symbol) {
  return {
    structural_fp: structuralFingerprint(symbol),
    dependency_fp: dependencyFingerprint(symbol),
  };
}

export function structuralFingerprint(symbol) {
  return digest({
    qname: symbol?.qname ?? '',
    signature: symbol?.signature ?? '',
    decorators: normalizedList(symbol?.decorators),
    parentClass: symbol?.parentClass ?? '',
    nodeType: symbol?.nodeType ?? '',
  });
}

export function dependencyFingerprint(symbol) {
  const outgoing = symbol?.outgoing ?? {};

  return digest({
    calls: normalizedList(outgoing.calls),
    references: normalizedList(outgoing.references),
    usesTypes: normalizedList(outgoing.usesTypes),
    imports: normalizedList(outgoing.imports),
    raises: normalizedList(outgoing.raises),
  });
}

function normalizedList(values) {
  return [...new Set((values ?? []).filter(Boolean).map(String))].sort();
}

function digest(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}
