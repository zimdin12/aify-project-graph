import crypto from 'node:crypto';
import { getProvider } from './providers/index.js';
import { dedupCollectionRecords } from './dedup-records.js';

const HINTS = {
  provider_missing: 'install the relevant provider tool (e.g. clangd) and add it to PATH, or set --no-code-intel to silence',
  compile_db_missing: 'compile_commands.json not found at projectRoot; run cmake -DCMAKE_EXPORT_COMPILE_COMMANDS=ON or set --no-code-intel to silence',
  language_unsupported: 'language not supported by any registered provider',
  wrapper_failed: 'apg code-intel wrapper exited non-zero; run `apg code-intel doctor <language>` for details',
  language_server_missing: 'language server binary missing on PATH; doctor reports the resolution chain',
  language_server_timeout: 'language server did not respond within startup window; retry or check resource limits',
  internal_error: 'unexpected provider failure; see message and provider logs'
};

const PROVIDER_BY_LANGUAGE = { cpp: 'cpp-clangd', typescript: 'ts-langserver', javascript: 'ts-langserver', python: 'pyright' };

function newCollectionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `ci-${ts}-${crypto.randomBytes(4).toString('hex')}`;
}

function errorCollection({ language, projectRoot, code, message }) {
  return {
    schema_version: '0.2',
    collectionId: newCollectionId(),
    provider: 'none',
    providerVersion: '0.0.0',
    projectRoot: projectRoot || '',
    session: { collectedAt: new Date().toISOString(), freshnessBasis: 'unknown' },
    operations: {},
    status: 'error',
    errors: [{ code, message, hint: HINTS[code] || '' }],
    records: []
  };
}

export async function runCollection(req) {
  const language = req.language;
  const providerName = PROVIDER_BY_LANGUAGE[language];
  if (!providerName) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'language_unsupported',
      message: `language '${language}' has no registered provider`
    });
  }

  const provider = getProvider(providerName);
  if (!provider) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'provider_missing',
      message: `provider '${providerName}' is not registered`
    });
  }

  try {
    const envelope = await provider.collect(req);
    // Collapse duplicate records (clangd re-reports each ref once per including
    // TU) BEFORE the verb serializes the envelope to a temp file — a whole-repo
    // collect can otherwise produce millions of byte-identical records that
    // overflow JSON.stringify and bloat the DB. Lossless: duplicates resolve to
    // the same edge. See dedup-records.js.
    if (envelope && Array.isArray(envelope.records) && envelope.records.length) {
      const before = envelope.records.length;
      envelope.records = dedupCollectionRecords(envelope.records);
      const dropped = before - envelope.records.length;
      if (dropped > 0) {
        envelope.session = { ...(envelope.session || {}), recordsBeforeDedup: before, recordsDeduped: dropped };
      }
    }
    return envelope;
  } catch (err) {
    return errorCollection({
      language, projectRoot: req.projectRoot,
      code: 'internal_error',
      message: err.message || String(err)
    });
  }
}

export { HINTS };
