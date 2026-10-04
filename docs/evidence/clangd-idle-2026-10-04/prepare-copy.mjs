// Point a repo's compile DB at a COPY of its sources, so clangd's index and APG's caches land in the copy and never
// in the team's working tree. Paths into the original BUILD directory are left alone: generated headers live there,
// and clangd only reads them. Also derives 5 lookup targets from the repo's own code: in the first own translation
// units (sorted), the first `Class::method(` definition gives `Class`.
//
//   node prepare-copy.mjs <origRoot> <origBuildDir> <copyRoot>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const [origRoot, origBuild, copyRoot] = process.argv.slice(2).map((p) => p.replaceAll('\\', '/').replace(/\/$/u, ''));
const db = JSON.parse(readFileSync(join(origBuild, 'compile_commands.json'), 'utf8'));
const forms = (p) => [p, p.replaceAll('/', '\\')];
const [rootF, rootB] = forms(origRoot);
const [buildF, buildB] = forms(origBuild);
const [copyF, copyB] = forms(copyRoot);
// Protect the build dir, swap the root, restore the build dir.
const swap = (s) => s
  .replaceAll(buildF, '\u0001BF').replaceAll(buildB, '\u0001BB')
  .replaceAll(rootF, copyF).replaceAll(rootB, copyB)
  .replaceAll('\u0001BF', buildF).replaceAll('\u0001BB', buildB);
const out = db.map((e) => ({ ...e, directory: swap(e.directory), file: swap(e.file), ...(e.command ? { command: swap(e.command) } : {}), ...(e.arguments ? { arguments: e.arguments.map(swap) } : {}) }));
writeFileSync(join(copyRoot, 'compile_commands.json'), JSON.stringify(out));

const own = out.map((e) => e.file.replaceAll('\\', '/')).filter((f) => f.startsWith(copyF) && !/_deps|third_party|external|vendor/iu.test(f) && existsSync(f)).sort();
const targets = [];
for (const f of own) {
  if (targets.length >= 5) break;
  const lines = readFileSync(f, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = /\b([A-Z][A-Za-z0-9_]+)::~?[A-Za-z_]\w*\s*\(/u.exec(lines[i]);
    if (m) { targets.push({ file: relative(copyRoot, f).replaceAll('\\', '/'), name: m[1], line: i + 1, col: m.index + 1 }); break; }
  }
}
writeFileSync(join(copyRoot, 'targets.json'), JSON.stringify(targets, null, 1));
const unswapped = out.filter((e) => e.file.replaceAll('\\', '/').startsWith(rootF + '/') && !e.file.replaceAll('\\', '/').startsWith(buildF)).length;
console.log(JSON.stringify({ units: out.length, ownInCopy: own.length, unswappedSourceUnits: unswapped, targets }));
