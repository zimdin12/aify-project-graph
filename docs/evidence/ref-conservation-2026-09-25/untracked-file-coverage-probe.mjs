// Does an UNTRACKED indexable file get a node? Decides the coverage limb's blind direction.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const load = (...p) => import(pathToFileURL(path.join(REPO, ...p)).href);
const { ensureFresh } = await load('mcp','stdio','freshness','orchestrator.js');
const { openDb } = await load('mcp','stdio','storage','db.js');
const git = (r,...a) => execFileSync('git',['-C',r,...a],{stdio:'ignore'});
const repo = await mkdtemp(path.join(tmpdir(),'apg-untracked-'));
try {
  await mkdir(path.join(repo,'src'),{recursive:true});
  git(repo,'init','-q'); git(repo,'config','user.name','p'); git(repo,'config','user.email','p@e.invalid');
  await writeFile(path.join(repo,'.gitignore'),'.aify-graph/\n');
  await writeFile(path.join(repo,'src','tracked.js'),'export function t(){return 1;}\n');
  git(repo,'add','-A'); git(repo,'commit','-qm','baseline');
  // NOW an untracked, indexable file — never committed, not in .gitignore
  await writeFile(path.join(repo,'src','untracked.js'),'export function u(){return 2;}\n');
  await ensureFresh({ repoRoot: repo });
  const db = openDb(path.join(repo,'.aify-graph','graph.sqlite'));
  const paths = db.all("SELECT DISTINCT file_path AS f FROM nodes WHERE file_path <> ''").map(r=>r.f);
  db.close();
  const tracked = paths.includes('src/tracked.js');
  const untracked = paths.includes('src/untracked.js');
  console.log('file_paths in graph:', JSON.stringify(paths));
  console.log('POSITIVE CONTROL  the TRACKED file has a node:', tracked ? 'YES' : 'NO — probe is void');
  console.log('ANSWER            the UNTRACKED file has a node:', untracked ? 'YES — so git ls-files UNDER-COUNTS the population' : 'NO — git ls-files matches what the pass covers');
} finally { await rm(repo,{recursive:true,force:true}); }
