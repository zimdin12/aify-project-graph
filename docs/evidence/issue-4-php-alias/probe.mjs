// #4 probe: what does apg's real PHP extractor emit for aliased `use` imports across a real Laravel application?
// Runs extractFile from the APG checkout given over every tracked .php file of the target repo and counts:
//   aliased   `use X as Y` clauses written in the source (tree-sitter, independent of the extractor);
//   rawAlias  IMPORTS targets that still carry " as " (unresolvable by construction);
//   aliasType USES_TYPE / REFERENCES targets that name a file's own alias instead of the class it stands for;
//   resolvable aliased IMPORTS whose target names a class file present in the repo (its composer.json PSR-4 map).
// Usage: node docs/evidence/issue-4-php-alias/probe.mjs <apg-checkout> <laravel-repo>
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [apg, repo] = process.argv.slice(2);
const load = (rel) => import(pathToFileURL(join(apg, rel)).href);
const { extractFile } = await load('mcp/stdio/ingest/extractors/generic.js');
const { getLanguageConfig } = await load('mcp/stdio/ingest/languages/index.js');
const files = execFileSync('git', ['-C', repo, 'ls-files', '*.php'], { encoding: 'utf8' }).trim().split('\n');
const config = getLanguageConfig('x.php');

const ALIAS_RE = /^\s*use\s+(?:function\s+|const\s+)?([A-Za-z_\\][A-Za-z0-9_\\]*)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)\s*;/gmu;
// The repo's own PSR-4 map (composer.json autoload.psr-4), so "a class file exists" is derived, not assumed.
const PSR4 = Object.entries(JSON.parse(readFileSync(join(repo, 'composer.json'), 'utf8')).autoload?.['psr-4'] ?? {});
const classFile = (fqn) => {
  const name = fqn.replace(/^\\+/u, '');
  const hit = PSR4.find(([prefix]) => name.startsWith(prefix));
  if (!hit) return null;
  const dir = Array.isArray(hit[1]) ? hit[1][0] : hit[1];
  return join(repo, dir, ...name.slice(hit[0].length).split('\\')) + '.php';
};
let aliased = 0; let rawAlias = 0; let aliasType = 0; let resolvable = 0; let resolvableTotal = 0;
const examples = [];
for (const rel of files) {
  const source = readFileSync(join(repo, rel), 'utf8');
  const aliases = new Map([...source.matchAll(ALIAS_RE)].map((m) => [m[2], m[1]]));
  aliased += aliases.size;
  const out = extractFile({ filePath: rel, source, config });
  for (const r of out.refs ?? []) {
    const t = String(r.target);
    if (r.relation === 'IMPORTS' && / as /u.test(t)) { rawAlias += 1; if (examples.length < 3) examples.push(`${rel}: IMPORTS ${JSON.stringify(t)}`); }
    if (['USES_TYPE', 'REFERENCES', 'EXTENDS', 'IMPLEMENTS'].includes(r.relation) && aliases.has(t.split('\\')[0])) { aliasType += 1; if (examples.length < 6) examples.push(`${rel}: ${r.relation} ${JSON.stringify(t)}`); }
    if (r.relation === 'IMPORTS') {
      for (const fqn of aliases.values()) {
        if (t !== fqn || classFile(fqn) === null) continue;
        resolvableTotal += 1;
        // A class alias names a file; a namespace alias (`use BookStack\Access\Controllers as AccessControllers`) a folder.
        if (existsSync(classFile(fqn)) || existsSync(classFile(fqn).replace(/\.php$/u, ''))) resolvable += 1;
      }
    }
  }
}
const head = (dir) => execFileSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
console.log(`apg ${head(apg)} on ${repo} ${head(repo)}: ${files.length} php files`);
console.log(`aliased use clauses in source: ${aliased}`);
console.log(`IMPORTS targets still carrying " as ": ${rawAlias}`);
console.log(`class-naming targets that start with an alias (Alias or Alias\\Rest): ${aliasType}`);
console.log(`aliased IMPORTS emitted as the FQN of a project class or namespace (${PSR4.map(([p]) => p).join(', ')}): ${resolvableTotal}, whose file or folder exists: ${resolvable}`);
for (const e of examples) console.log(`  e.g. ${e}`);
