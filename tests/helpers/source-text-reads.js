// #10 criterion 3: which test files read PRODUCT SOURCE TEXT, observed at runtime rather than guessed from test text.
//
// A test that reads mcp/stdio/server.js and matches a regex against it cannot fail when the behaviour breaks, and it
// breaks when a line is reflowed. suite-composition.test.js classifies such files statically, and that classifier is
// wrong in both directions: it counts a test that reads a log it generated (any readFileSync in a file that also
// holds an mcp/ path), and it misses a test that walks mcp/ to read every file. So the count is taken from the reads.
//
// Counted: a read through fs.readFileSync or fs.promises.readFile, made by TEST code (the calling frame is under
// tests/), of a JavaScript file in a directory of this checkout other than tests/, docs/, node_modules and
// dot-directories (so mcp/, scripts/, bin/, tools/, integrations/; not root-level config). Product code reading
// its own files, a module load, and generated output (logs, written configs, temp files) do not count.
// Not seen: reads in a child process, and reads through other APIs (streams, fs.readFile with a callback).
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_READS_FILE = 'product-source-reads.log';
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CODE = /\.[cm]?js$/u;
// Tests, evidence scripts under docs/, dependencies, and root-level files (vitest.config.js is test tooling).
const NOT_PRODUCT = new Set(['tests', 'docs', 'node_modules']);
const THIS_MECHANISM = /\/tests\/helpers\/source-text-reads(?:\.setup)?\.js/u;

const posix = (p) => p.split(sep).join('/');

/** The repo-relative path when `path` names product source, else null. */
export function productSourcePath(path) {
  if (typeof path !== 'string' && !(path instanceof URL)) return null; // a file descriptor or a Buffer path
  let absolute;
  try { absolute = resolve(path instanceof URL ? fileURLToPath(path) : path); } catch { return null; }
  const rel = relative(REPO, absolute);
  if (!rel || rel.startsWith('..') || !CODE.test(rel)) return null;
  const segments = posix(rel).split('/');
  if (segments.length === 1 || NOT_PRODUCT.has(segments[0]) || segments[0].startsWith('.')) return null;
  return posix(rel);
}

/** True when the first frame outside this mechanism is test code, and the read is not a module load. */
export function readByTestCode(stack) {
  const frames = String(stack).split('\n').slice(1).map((l) => posix(l.trim()));
  if (frames.some((f) => f.includes('node:internal/modules'))) return false;
  const caller = frames.find((f) => !THIS_MECHANISM.test(f));
  return caller !== undefined && caller.includes('/tests/');
}

/** One record line, or null when this read does not count. The stack is only taken for product paths. */
export function productSourceRead(path, stackOf, testFile) {
  const source = productSourcePath(path);
  if (!source || !readByTestCode(stackOf())) return null;
  return `${testFile ? posix(relative(REPO, testFile)) : '(unknown test file)'}\t${source}`;
}

/** The test files in `records` that read product source and are not in `known`. */
export function unlistedReaders(records, known) {
  const readers = new Set(records.map((r) => r.split('\t')[0]));
  return [...readers].filter((f) => !known.has(f)).sort();
}

// THE RATCHET. Every test file below reads product source text in its own code. The list may shrink: convert a file
// to a behavioural test and remove it. A file not on the list that reads product source fails the run
// (tests/helpers/temp-root.global.js), in a single-file run as well as a full one. Adding a file here is a decision
// that its artifact under test is text; say why in its header.
export const KNOWN_PRODUCT_SOURCE_READERS = new Set([
  // The 57 files observed on 2026-11-08 when this ratchet was introduced (#10). Not argued one by one: they are the
  // debt the ratchet starts from. Convert one when it next breaks, and remove it here.
  'tests/unit/code-intel/converged-not-empty.test.js',
  'tests/unit/code-intel/every-clangd-spawn-bounds-pch.test.js',
  'tests/unit/code-intel/evidence-unavailable-remedy.test.js',
  'tests/unit/code-intel/guessed-position-not-queried.test.js',
  'tests/unit/code-intel/index-readiness-covers-the-client.test.js',
  'tests/unit/code-intel/resolve-clang-cl.test.js',
  'tests/unit/code-intel/selection-selector.test.js',
  'tests/unit/dashboard/explain-diff-endpoint.test.js',
  'tests/unit/extractor-labels-have-one-writer.test.js',
  'tests/unit/ingest/extraction-reports-its-coverage.test.js',
  'tests/unit/ingest/identity-helpers-have-one-owner.test.js',
  'tests/unit/integrations/legacy-collector-is-never-the-recommendation.test.js',
  'tests/unit/integrations/no-surface-claims-bundled-clangd.test.js',
  'tests/unit/integrations/no-surface-licenses-absence.test.js',
  'tests/unit/integrations/refresh-docs-parity.test.js',
  'tests/unit/integrations/verb-count-parity.test.js',
  'tests/unit/no-extension-list-outside-the-registry.test.js',
  'tests/unit/no-raw-nul-bytes.test.js',
  'tests/unit/overlay/task-status.test.js',
  'tests/unit/query/a-cap-is-not-a-count.test.js',
  'tests/unit/query/absence-authority-is-not-honoured-by-any-verb.test.js',
  'tests/unit/query/absence-headlines-name-the-scope.test.js',
  'tests/unit/query/cause-vocabulary.test.js',
  'tests/unit/query/empty-set-absence-names-uncommitted.test.js',
  'tests/unit/query/every-absence-names-its-scope.test.js',
  'tests/unit/query/every-absence-names-its-unmodelled-constructs.test.js',
  'tests/unit/query/framing-not-data.test.js',
  'tests/unit/query/fresh-per-call.test.js',
  'tests/unit/query/one-git-observation-per-read.test.js',
  'tests/unit/query/overcount-risk.test.js',
  'tests/unit/query/packet-authority-boundaries.test.js',
  'tests/unit/query/packet-route-inventory.test.js',
  'tests/unit/query/packet-seal.test.js',
  'tests/unit/query/pull-docs-unconsulted-source.test.js',
  'tests/unit/query/pull-relations.test.js',
  'tests/unit/query/record-volume-canary.test.js',
  'tests/unit/query/remedy-names-a-reachable-verb.test.js',
  'tests/unit/query/remedy-reachability.test.js',
  'tests/unit/query/response-budget.test.js',
  'tests/unit/query/server-build-identity.test.js',
  'tests/unit/query/server-reports-its-own-version.test.js',
  'tests/unit/query/staleness-consequence.test.js',
  'tests/unit/query/surfaces-agree-on-scope.test.js',
  'tests/unit/query/token-estimate-has-one-constant.test.js',
  'tests/unit/scripts/adoption-gate-is-recorded-not-remembered.test.js',
  'tests/unit/scripts/anchor-addressability.test.js',
  'tests/unit/scripts/arm-workspace.test.js',
  'tests/unit/scripts/audit-preconditions-still-hold.test.js',
  'tests/unit/scripts/carrier-must-hold-across-the-run.test.js',
  'tests/unit/scripts/hazard-detectors.test.js',
  'tests/unit/scripts/mutation-restore-cannot-eat-uncommitted-work.test.js',
  'tests/unit/scripts/reindex-payload.test.js',
  'tests/unit/scripts/suite-run-integrity.test.js',
  'tests/unit/source-files-do-not-grow.test.js',
  'tests/unit/storage/code-node-types-has-one-owner.test.js',
  'tests/unit/storage/producers-emit-only-declared-types.test.js',
  'tests/unit/util/append-all.test.js',
]);
