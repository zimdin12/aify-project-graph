#!/usr/bin/env node
// GENERATE docs/reference-corpus.md FROM THE CLONES THEMSELVES.
//
// Why generated and not written: the only licence record this repo had was a table inside
// docs/reference-pull-and-audit-2026-06-12.md. By 2026-09-25 it listed four of seven projects, and
// its graphify licence line had already been wrong once (corrected from "MIT (v8)" to Apache-2.0 on
// 2026-08-19). That correction never reached ATTRIBUTION.md, which still called graphify MIT while a
// teammate was preparing to vendor Apache-2.0 code from it. A hand-written list rots, and a rotted
// licence line is the kind that costs something.
//
// ⛔ A DIRECTORY WITHOUT ITS OWN `.git` IS A HARD REFUSAL, NOT A SKIP.
// `reference/agent-code-intel.mcp-snapshot-20260508` is three files with no `.git` of its own. A
// per-directory `git -C <dir> rev-parse HEAD` walks UP out of it and answers with
// aify-project-graph's OWN sha, so an audit loop silently records this repo as a reference project at
// today's commit. That is a wrong answer that agrees with expectation, so nothing prompts a check.
// Refusing by name makes the directory visibly absent instead of quietly misreported.
//
// CONTROLS, in the same run:
//   POSITIVE  at least one directory must resolve to a remote and a sha, or the git probe is dead and
//             every "no remote" below is the instrument's failure rather than the corpus's state.
//   NEGATIVE  a fabricated directory name must be reported as not present.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORPUS = path.join(REPO, 'reference');
const OUT = path.join(REPO, 'docs', 'reference-corpus.md');
const FABRICATED = 'zzq-not-a-reference-project';

function git(dir, args) {
  try {
    return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// The licence NAME as the repository itself states it, never as any note of ours claims.
function licenceOf(dir) {
  const files = fs.readdirSync(dir).filter((f) => /^licen[cs]e/i.test(f)).sort();
  if (files.length === 0) return { files: [], name: 'NO LICENCE FILE — ideas only, no code reuse' };
  const head = fs.readFileSync(path.join(dir, files[0]), 'utf8').replace(/\r/g, '').split('\n').slice(0, 6).join(' ');
  if (/Apache License/i.test(head)) {
    const version = head.match(/Version\s+([\d.]+)/i);
    return { files, name: `Apache-${version ? version[1].replace(/\.0$/, '.0') : '2.0'}` };
  }
  if (/MIT License/i.test(head)) return { files, name: 'MIT' };
  const other = head.match(/Mozilla Public License|BSD [\w-]*License|GNU [\w ]*Public License/i);
  return { files, name: other ? other[0] : `UNRECOGNISED — first lines: ${head.slice(0, 80)}` };
}

// ⛔ ONLY A REAL COPYRIGHT STATEMENT, never every line containing the word.
// The first version of this took every matching line and produced, for an Apache-2.0 project, twelve
// lines of the licence TEMPLATE including the literal `Copyright [yyyy] [name of copyright owner]` —
// a placeholder presented as an attribution obligation. The pattern requires a year, and the yyyy
// placeholder is excluded explicitly.
function copyrightLines(dir, licenceFiles) {
  const lines = [];
  for (const file of licenceFiles) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r/g, '');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!/^Copyright\b/i.test(trimmed)) continue;
      if (/\[yyyy\]/i.test(trimmed)) continue;
      if (!/\b(19|20)\d{2}\b/.test(trimmed)) continue;
      lines.push(trimmed);
    }
  }
  return [...new Set(lines)];
}

// An Apache-2.0 NOTICE has to travel with anything taken from the project. Its ABSENCE is a fact
// worth printing too: understory is Apache-2.0 and ships none, so there is no NOTICE obligation
// there, and a reader should not have to go and check.
function noticeOf(dir) {
  const file = fs.readdirSync(dir).find((f) => /^notice(\.|$)/i.test(f));
  return file ?? '';
}

if (!fs.existsSync(CORPUS)) {
  console.error(`REFUSED: ${CORPUS} does not exist. Nothing to describe.`);
  process.exit(1);
}

const entries = fs.readdirSync(CORPUS, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

const refused = [];
const rows = [];
for (const name of entries) {
  const dir = path.join(CORPUS, name);
  if (!fs.existsSync(path.join(dir, '.git'))) {
    refused.push(name);
    continue;
  }
  const licence = licenceOf(dir);
  rows.push({
    name,
    remote: git(dir, ['config', '--get', 'remote.origin.url']) || 'NO REMOTE',
    sha: git(dir, ['rev-parse', '--short', 'HEAD']) || 'NO HEAD',
    date: git(dir, ['log', '-1', '--format=%ad', '--date=short']) || 'UNKNOWN',
    licence: licence.name,
    licenceFiles: licence.files,
    notice: noticeOf(dir),
    // NOTICE is scanned too: an Apache-2.0 LICENSE carries no concrete copyright line, only the
    // `[yyyy]` template, so scanning LICENSE alone finds the holder for MIT projects and misses it
    // for exactly the projects whose attribution is mandatory.
    copyrights: copyrightLines(dir, [...licence.files, noticeOf(dir)].filter(Boolean)),
  });
}

const resolved = rows.filter((r) => r.remote !== 'NO REMOTE' && r.sha !== 'NO HEAD').length;
console.log(`POSITIVE CONTROL: ${resolved} of ${rows.length} clone(s) resolved to a remote and a sha`);
console.log(`NEGATIVE CONTROL: fabricated directory ${FABRICATED} -> ${entries.includes(FABRICATED) ? 'PRESENT — the listing is not reading this corpus' : 'not present, as it must be'}`);
if (resolved === 0) {
  console.error('REFUSED: no directory resolved to a remote and a sha. The git probe is dead; nothing written.');
  process.exit(1);
}

const lines = [];
lines.push('# Reference corpus');
lines.push('');
lines.push('⛔ GENERATED by `scripts/generate-reference-corpus.mjs`. Do not hand-edit: the previous');
lines.push('hand-written record listed four of seven projects and carried a wrong licence for one of');
lines.push('them. Re-run the script instead.');
lines.push('');
lines.push(`Generated ${new Date().toISOString().slice(0, 10)} from the clones in \`reference/\`, which is`);
lines.push('gitignored — the corpus is not tracked, so this file is the only record of what was in it.');
lines.push('');
lines.push('**Licences are read from each repository\'s own LICENSE file, never from a note of ours.**');
lines.push('A project with no licence file is ideas only: no code may be copied from it.');
lines.push('');
lines.push('| project | remote | HEAD | last commit | licence | NOTICE |');
lines.push('|---|---|---|---|---|---|');
for (const r of rows) {
  const notice = r.notice ? `\`${r.notice}\` — must travel with anything taken` : 'none — no NOTICE obligation';
  lines.push(`| ${r.name} | ${r.remote} | \`${r.sha}\` | ${r.date} | ${r.licence} | ${notice} |`);
}
lines.push('');
const withCopyright = rows.filter((r) => r.copyrights.length > 0);
if (withCopyright.length > 0) {
  lines.push('## Copyright lines, as each LICENSE and NOTICE states them');
  lines.push('');
  lines.push('Attribution must carry every line a licence names. A derivative work carries two.');
  lines.push('');
  for (const r of withCopyright) {
    lines.push(`- **${r.name}** (${[...r.licenceFiles, r.notice].filter(Boolean).join(", ")}): ${r.copyrights.join(' · ')}`);
  }
  lines.push('');
}
if (refused.length > 0) {
  lines.push('## ⛔ Refused: present in `reference/` but not a clone');
  lines.push('');
  lines.push('These directories have no `.git` of their own. A per-directory `git -C <dir> rev-parse HEAD`');
  lines.push('walks UP out of them and answers with THIS repository\'s sha, which reads as a reference');
  lines.push('project sitting at our own commit. They are named here rather than skipped so the gap is');
  lines.push('visible.');
  lines.push('');
  for (const name of refused) lines.push(`- \`reference/${name}\``);
  lines.push('');
}
lines.push('## What this file cannot tell you');
lines.push('');
lines.push('Nothing about what was REMOVED from the corpus. `reference/` is gitignored and no inventory');
lines.push('was ever tracked, so a clone deleted before today left no trace anywhere. This file starts');
lines.push('the record; it cannot reconstruct one.');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`WROTE ${path.relative(REPO, OUT)} — ${rows.length} clone(s), ${refused.length} refused`);
for (const name of refused) console.log(`  REFUSED (no .git): reference/${name}`);
