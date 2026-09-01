// BLAST RADIUS of adding a normalized parameter list to the canonical symbol key.
//
// Preregistered: docs/evidence/m1b-overloads/PREREGISTRATION-param-list-key.md.
// The abandon rule fires on a SINGLE wrong split, so this reports every split, not a count.
//
//   node scripts/m1b-param-key-blast-radius.mjs
//
// ⛔ GROUPING USES THE PRODUCT'S OWN `canonicalSymbolKey`. A reimplementation here would drift from
// the shipped one and then measure its own drift.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openExistingDb } from '../mcp/stdio/storage/db.js';
import { canonicalSymbolKey } from '../mcp/stdio/query/verbs/symbol_lookup.js';
import { normalizedParamList } from '../mcp/stdio/query/param-signature.js';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const NODE_SQL = 'SELECT id, type, label, file_path, start_line, extra FROM nodes';

function extraOf(row) {
  try { return JSON.parse(row.extra || '{}'); } catch { return {}; }
}

// The V1 variant the preregistration asks to be reported alongside: the RAW parenthesised text,
// with no name stripping. It is a substring, not a second algorithm — reporting it shows what the
// name-stripping actually bought.
function rawParenText(signature) {
  if (typeof signature !== 'string') return null;
  const open = signature.indexOf('(');
  const close = signature.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  return signature.slice(open, close + 1);
}

function groupRows(rows, discriminator) {
  const groups = new Map();
  for (const row of rows) {
    const base = canonicalSymbolKey(row);
    const extra = extraOf(row);
    const suffix = discriminator(extra.signature);
    const key = suffix == null ? base : `${base}${suffix}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function analyse(rows, label) {
  const before = groupRows(rows, () => null);
  const afterV2 = groupRows(rows, normalizedParamList);
  const afterV1 = groupRows(rows, rawParenText);

  const withParens = rows.filter((r) => rawParenText(extraOf(r).signature) != null).length;

  // Which of the original groups actually fragment under V2?
  const splits = [];
  for (const [key, members] of before) {
    if (members.length < 2) continue;
    const sub = new Set(members.map((m) => {
      const s = normalizedParamList(extraOf(m).signature);
      return s == null ? '(none)' : s;
    }));
    if (sub.size > 1) {
      splits.push({
        key,
        members_before: members.length,
        groups_after: sub.size,
        rows: members.map((m) => ({
          at: `${m.file_path}:${m.start_line}`,
          signature: extraOf(m).signature ?? null,
          normalized: normalizedParamList(extraOf(m).signature),
        })),
      });
    }
  }

  console.log(`\n──── ${label}`);
  console.log(`rows: ${rows.length}   rows with a parenthesised signature: ${withParens}`);
  if (withParens === 0) {
    console.log('⛔ POSITIVE CONTROL FAILED — no row carries a parenthesised signature.');
    console.log('   The scan is BLIND here; a "nothing splits" result from this population is VOID.');
  }
  console.log(`groups: before=${before.size}  afterV2(names stripped)=${afterV2.size}  afterV1(raw text)=${afterV1.size}`);
  const pct = before.size ? ((splits.length / before.size) * 100).toFixed(3) : '0';
  console.log(`groups that FRAGMENT under V2: ${splits.length} of ${before.size} (${pct}%)`);
  for (const s of splits) {
    console.log(`  ${s.key}  ${s.members_before} -> ${s.groups_after}`);
    for (const r of s.rows) console.log(`      ${r.at}  sig=${JSON.stringify(r.signature)}  norm=${JSON.stringify(r.normalized)}`);
  }
  return { splits, before: before.size, withParens };
}

function readRows(repoRoot) {
  const db = openExistingDb(path.join(repoRoot, '.aify-graph', 'graph.sqlite'));
  const rows = db.all(NODE_SQL);
  db.close();
  return rows;
}

async function indexedFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `apg-blast-${name}-`));
  fs.cpSync(path.join(REPO, 'tests/fixtures', name), dir, { recursive: true });
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'i');
  const { graphIndex } = await import('../mcp/stdio/query/verbs/index.js');
  await graphIndex({ repoRoot: dir });
  const rows = readRows(dir);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* handle */ }
  return rows;
}

const primary = analyse(readRows(REPO), 'PRIMARY POPULATION — this repo\'s own graph');
const hostile = analyse(await indexedFixture('identity-hostile'), 'CONTROL — tests/fixtures/identity-hostile (overloads MUST split)');
const callers = analyse(await indexedFixture('identity-callers'), 'CONTROL — tests/fixtures/identity-callers (decl/def MUST NOT split)');

console.log('\n──── CONTROLS');
const clampSplit = hostile.splits.some((s) => s.key.includes('clamp') && s.groups_after === 2);
console.log(`POSITIVE (mechanism): identity-hostile clamp splits into 2 -> ${clampSplit ? 'PASS' : 'FAIL'}`);
const renderForked = callers.splits.some((s) => s.key.includes('render'));
console.log(`NEGATIVE (regression): identity-callers render decl/def stays ONE group -> ${renderForked ? 'FAIL — IT FORKED' : 'PASS'}`);
console.log(`POSITIVE (on the zero): primary population has ${primary.withParens} signatures with parens -> ${primary.withParens > 0 ? 'PASS' : 'FAIL (scan blind)'}`);

const pct = primary.before ? (primary.splits.length / primary.before) * 100 : 0;
console.log(`\nPRIMARY BLAST RADIUS: ${primary.splits.length} of ${primary.before} groups (${pct.toFixed(3)}%) — preregistered hold threshold is 1%`);
console.log(`VERDICT INPUTS: mechanism=${clampSplit ? 'ok' : 'FAILED'} regression=${renderForked ? 'FAILED' : 'ok'} radius=${pct <= 1 ? 'under' : 'OVER'} threshold`);
