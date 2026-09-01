#!/usr/bin/env node
// Differential carrier for M1a step B (gates 1 and 7).
//
// Both gates are differentials between TWO checkouts. The checkout supplies only the CODE; the
// fixture, the tracked-file list, the source bytes AND the population definition all come from
// this working tree, so the two runs differ in exactly one variable. Running it against a single
// checkout proves only that the code agrees with itself.
//
//   git worktree add --detach ../apg-preb <pre-B commit>
//   node scripts/step-b-identity-differential.mjs canonical ../apg-preb > pre.jsonl
//   node scripts/step-b-identity-differential.mjs canonical .           > post.jsonl
//   diff pre.jsonl post.jsonl
//
// Modes: `sites` (gate 7, the frozen identity-hostile fixture) and `canonical` (gate 1, every
// tracked source whose language did NOT opt in to the step-B change).
//
// ⚠ FOUR THINGS AN EARLIER VERSION GOT WRONG. They are recorded because each one produced a
// confident, wrong, GREEN result:
//   1. `catch { continue }` swallowed every extraction error and ASSUMED both checkouts failed on
//      the same files. Equal row counts can hide different skipped files — a fail-open instrument
//      certifying a fail-closed claim. Every candidate now emits exactly one `file` row carrying
//      its disposition, so a disposition change IS a diff line.
//   2. Non-C++ was selected with a hand-maintained extension denylist. The population is now
//      DERIVED — a file is in scope iff its language config does not declare `lexicalScope`,
//      which is exactly "did not opt in". The derived population is LARGER than the denylist's
//      (778 vs 774): the list was quietly wrong as well as unmaintainable.
//   3. Rows were delimiter-joined anonymous tuples with no path. They are canonical JSON now,
//      path on every row, multiplicity preserved.
//   4. It emitted `ref.from_target`, which does not exist on a ref: 0 of 65,813 rows non-empty.
//      It compared nothing while making the compared surface look wider than it was.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SYMBOL_TYPES = new Set(['Function', 'Method', 'Class', 'Struct', 'Test']);

async function loadCheckout(root) {
  const at = (rel) => pathToFileURL(path.join(root, rel)).href;
  const { extractFile } = await import(at('mcp/stdio/ingest/extractors/generic.js'));
  const { getLanguageConfig } = await import(at('mcp/stdio/ingest/languages/index.js'));
  return { extractFile, getLanguageConfig };
}

// ⚠ `getLanguageConfig` THROWS for an unsupported path rather than returning a falsy value. An
// earlier version tested `Boolean(config)` and the run died on the first JSON file — and because
// BOTH sides died, the two output files were empty and `diff` called them EQUAL. The differential
// reported "identical" from two crashed runs. Hence this wrapper, and hence `refuseEmpty` below:
// an instrument that cannot distinguish "no differences" from "no data" is not evidence.
function configFor(checkout, filePath) {
  try {
    return checkout.getLanguageConfig(filePath) ?? null;
  } catch {
    return null;
  }
}

// The population definition comes from THIS working tree, identically for both runs. Deriving it
// from each checkout's own config would move the population itself — pre-B declares `lexicalScope`
// nowhere, so every C++ file would enter the pre-B population and leave the post-B one, and that
// membership change would swamp the differential it is supposed to expose.
function selectCandidates(local, mode) {
  // `canonical` = every language that did NOT opt in to step B (gate 1).
  // `cpp`       = the languages that DID, used to show the qualified-fallback deletion changed no
  //               extracted C++ symbol. Both are DERIVED from the config, never listed.
  const wantOptedIn = mode === 'cpp';
  return execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((filePath) => {
      const config = configFor(local, filePath);
      return Boolean(config) && Boolean(config.lexicalScope) === wantOptedIn;
    });
}

// One row per candidate, always. `disposition` is the typed outcome, never a silent skip.
function canonicalRows(checkout, candidates) {
  const rows = [];
  for (const filePath of candidates) {
    const config = configFor(checkout, filePath);
    if (!config) {
      rows.push({ kind: 'file', path: filePath, language: null, disposition: 'unsupported' });
      continue;
    }
    let result = null;
    let failure = null;
    try {
      const source = fs.readFileSync(path.join(REPO, filePath), 'utf8');
      result = checkout.extractFile({ filePath, source, config });
    } catch (error) {
      failure = error?.code ?? error?.name ?? 'UNTYPED_ERROR';
    }
    if (failure) {
      rows.push({ kind: 'file', path: filePath, language: config.language, disposition: 'error', error: failure });
      continue;
    }
    const nodes = result.nodes ?? [];
    const refs = result.refs ?? [];
    // The classification each checkout made is emitted, so a disagreement between the two shows up
    // as a diff line rather than being absorbed by a script-internal assertion nobody reads.
    rows.push({
      kind: 'file',
      path: filePath,
      language: config.language,
      disposition: 'ok',
      nodes: nodes.length,
      refs: refs.length,
    });
    for (const node of nodes) {
      rows.push({
        kind: 'node',
        path: filePath,
        id: node.id,
        type: node.type,
        label: node.label,
        qname: node.extra?.qname ?? null,
        parent_class: node.extra?.parent_class ?? null,
        // The two step-B carriers. For an opted-out language both must stay absent; `null` here
        // records "the field was not present", which is the asserted state rather than a gap.
        lexical_scope: node.extra?.lexical_scope ?? null,
        written_qualifier: node.extra?.written_qualifier ?? null,
      });
    }
    for (const ref of refs) {
      rows.push({
        kind: 'ref',
        path: filePath,
        relation: ref.relation ?? null,
        from_id: ref.from_id ?? null,
        target: ref.target ?? null,
      });
    }
  }
  return rows;
}

function sitePopulation(checkout) {
  const dir = path.join(REPO, 'tests/fixtures/identity-hostile/src');
  const rows = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const filePath = `src/${file}`;
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const config = configFor(checkout, filePath);
    const result = checkout.extractFile({ filePath, source, config });
    for (const node of result.nodes ?? []) {
      if (SYMBOL_TYPES.has(node.type)) rows.push(`${filePath}:${node.start_line}:${node.id}`);
    }
  }
  return rows;
}

// ⛔ THE SERIALIZER USED TO DESTROY THE CONTENT IT WAS COMPARING.
//
// It was `JSON.stringify(row, Object.keys(row).sort())`. An ARRAY replacer applies at EVERY level,
// so a nested `{segment, authority}` had both keys filtered out and serialized as `{}`. Two
// carriers with completely different content produced byte-identical output and compared EQUAL:
//   {segment:'alpha',authority:'lexical_ast'} vs {segment:'BETA',authority:'DIFFERENT'} -> both `[{}]`
// So the gate compared carrier PRESENCE while reporting content parity. The negative control did
// not catch it because it mutated the serialized TEXT — downstream of the defect, where the damage
// has already happened. A control below the fault cannot see the fault.
//
// This canonicalizer sorts OBJECT keys only and preserves ARRAY order, because scope segments are
// ordered outermost-first and a swap is a real difference. It refuses rather than coerces:
// `undefined` would silently vanish and collapse absent-versus-present, which is the exact
// distinction these carriers exist to make.
function canonicalize(value, seen) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`non-finite number in canonical row: ${value}`);
    return value;
  }
  if (type !== 'object') throw new TypeError(`unsupported value in canonical row: ${type}`);
  if (seen.has(value)) throw new TypeError('cycle in canonical row');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) {
        throw new TypeError(`undefined value at key "${key}" — absent and undefined must not collapse`);
      }
      out[key] = canonicalize(value[key], seen);
    }
    return out;
  } finally {
    seen.delete(value);
  }
}

const canonicalJson = (row) => JSON.stringify(canonicalize(row, new Set()));

// Identity-bearing rows must be unique, so equal carrier bytes on two different nodes cannot
// cancel out through a multiset comparison. Ref rows are deliberately exempt: the same call
// appearing twice is real multiplicity, not a duplicate record.
function refuseDuplicateIdentities(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (row.kind === 'ref') continue;
    const key = row.kind === 'node' ? `node:${row.path}:${row.id}` : `file:${row.path}`;
    if (seen.has(key)) {
      process.stderr.write(`REFUSED: duplicate row identity ${key}; comparison would be ambiguous\n`);
      process.exit(4);
    }
    seen.set(key, true);
  }
  return rows;
}

// A differential over an empty population is indistinguishable from one with no differences.
// Fail closed rather than emit nothing and let `diff` report success.
function refuseEmpty(rows, what) {
  if (rows.length === 0) {
    process.stderr.write(`REFUSED: ${what} produced 0 rows; an empty population cannot certify anything\n`);
    process.exit(3);
  }
  return rows;
}

const [mode, checkoutPath] = process.argv.slice(2);
if (!['sites', 'canonical', 'cpp'].includes(mode) || !checkoutPath) {
  process.stderr.write('usage: step-b-identity-differential.mjs <sites|canonical> <checkout-path>\n');
  process.exit(2);
}

const local = await loadCheckout(REPO);
const checkout = await loadCheckout(path.resolve(checkoutPath));

if (mode === 'sites') {
  const rows = refuseEmpty(sitePopulation(checkout), 'site population');
  process.stdout.write(`${rows.sort().join('\n')}\n`);
  process.stderr.write(`sites=${rows.length}\n`);
} else {
  const candidates = refuseEmpty(selectCandidates(local, mode), `${mode} candidate list`);
  const rows = refuseDuplicateIdentities(
    refuseEmpty(canonicalRows(checkout, candidates), `${mode} population`),
  );
  const serialized = rows.map(canonicalJson).sort();
  process.stdout.write(`${serialized.join('\n')}\n`);
  const tally = rows.reduce((acc, row) => {
    const key = row.kind === 'file' ? `file:${row.disposition}` : row.kind;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  process.stderr.write(`candidates=${candidates.length} ${Object.entries(tally).map(([k, v]) => `${k}=${v}`).join(' ')}\n`);
}
