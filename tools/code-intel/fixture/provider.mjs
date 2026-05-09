import crypto from 'node:crypto';

const HINTS = {
  compile_db_missing:
    'compile_commands.json not found at projectRoot; run cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or set --no-code-intel to silence',
  provider_missing: 'install clangd and add it to PATH or set --no-code-intel to silence',
  language_unsupported: 'language not supported by this provider; check provider capabilities',
  wrapper_failed: 'apg code-intel wrapper exited non-zero; run apg code-intel doctor for details',
  language_server_missing: 'language server binary missing; doctor reports the resolution chain',
  language_server_timeout: 'language server did not respond within startup window',
  internal_error: 'see provider logs',
};

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const tail = crypto.randomBytes(4).toString('hex');
  return `ci-${ts}-${tail}`;
}

export async function runFixtureProvider(req) {
  const collectionId = newCollectionId();
  const provider = 'fixture';
  const providerVersion = '0.1.0';
  const collectedAt = new Date().toISOString();

  if (req.simulate?.error) {
    const code = req.simulate.error.code || 'internal_error';
    return {
      schema_version: '0.2',
      collectionId,
      provider,
      providerVersion,
      projectRoot: req.projectRoot,
      session: { collectedAt, freshnessBasis: 'unknown' },
      operations: {},
      status: 'error',
      errors: [{ code, message: `simulated ${code}`, hint: HINTS[code] || '' }],
      records: [],
    };
  }

  const operations = {};
  const records = [];
  const partialMap = req.simulate?.partial || {};

  for (const op of req.operations || []) {
    const partialFiles = partialMap[op] || [];
    if (partialFiles.length > 0) {
      operations[op] = {
        status: 'partial',
        count: Math.max(0, (req.files?.length || 0) - partialFiles.length),
        notCollectedFiles: partialFiles,
      };
    } else {
      operations[op] = { status: 'ok', count: 0 };
    }
  }

  const targetFiles = (req.files || ['src/sample.cpp']).filter(
    (f) => !(partialMap['definitions'] || []).includes(f)
  );

  for (const file of targetFiles) {
    if (operations.definitions) {
      records.push({
        schema_version: '0.2',
        collectionId,
        kind: 'definition',
        language: req.language,
        symbolId: `c:@F@sample_${file.replace(/[^a-z0-9]/gi, '_')}#`,
        qname: `sample::sample_${file.replace(/[^a-z0-9]/gi, '_')}()`,
        signature: 'void()',
        container: 'sample',
        file,
        range: { start: { line: 1, col: 1 }, end: { line: 1, col: 10 } },
        confidence: 'high',
        provenance: `${provider}@${providerVersion}`,
        result_state: 'found',
      });
      operations.definitions.count = (operations.definitions.count || 0) + 1;
    }
    if (operations.references && !(partialMap['references'] || []).includes(file)) {
      records.push({
        schema_version: '0.2',
        collectionId,
        kind: 'reference',
        language: req.language,
        symbolId: `c:@F@sample_${file.replace(/[^a-z0-9]/gi, '_')}#`,
        qname: `sample::sample_${file.replace(/[^a-z0-9]/gi, '_')}()`,
        container: 'sample',
        file,
        range: { start: { line: 5, col: 1 }, end: { line: 5, col: 10 } },
        context: 'call_expr',
        confidence: 'high',
        provenance: `${provider}@${providerVersion}`,
        result_state: 'found',
      });
      operations.references.count = (operations.references.count || 0) + 1;
    }
  }

  const anyPartial = Object.values(operations).some((o) => o.status === 'partial');
  const status = anyPartial ? 'partial' : 'ok';

  return {
    schema_version: '0.2',
    collectionId,
    provider,
    providerVersion,
    projectRoot: req.projectRoot,
    session: { collectedAt, freshnessBasis: 'unknown' },
    operations,
    status,
    records,
  };
}
