// THE A/B CORPUS BUILDER — one owner for what an arm actually sees.
//
// ⛔ THE COMPILE DB IS NOT A DETAIL, IT IS A TASK CLASS. C3 asks "which translation unit contains
// this symbol", and the honest answer depends entirely on the TU population the build declares. A
// corpus with no compile_commands.json cannot pose that question at all, and a corpus with a
// hardcoded one poses whichever version happened to get written.
//
// So the TU population is an explicit MODE, and both modes are buildable over identical source
// bytes:
//
//   'separate'  each .cpp is its own TU, bundle.cpp excluded  — the ordinary case
//   'unity'     ONLY bundle.cpp is a TU, and it #includes the others — the unity case
//   'none'      no compile DB at all                          — the shipped default for most repos
//
// ⚠ GENERATED PER RUN, NEVER STORED. compile_commands.json needs absolute paths, and every arm gets
// its own temp directory, so a checked-in file would point at whatever machine wrote it.
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = 'C:/Docker/aify-project-graph';
const CORPUS = join(ROOT, 'tests', 'fixtures', 'linkage-scope', 'corpus');
const CLANG = 'C:/Program Files/LLVM/bin/clang-cl.exe';

export const CORPUS_FILES = Object.freeze([
  'weights.cpp', 'pipeline.cpp', 'bundle.cpp', 'normalize.h', 'normalize.cpp', 'stage.cpp', 'gain.cpp',
]);

// Which .cpp files are real translation units, per mode. bundle.cpp #includes weights.cpp and
// pipeline.cpp, so listing all three would compile their contents TWICE and is not a build anyone
// would ship — the modes are mutually exclusive by construction, not by convention.
const TU_SETS = Object.freeze({
  separate: ['weights.cpp', 'pipeline.cpp', 'normalize.cpp', 'stage.cpp', 'gain.cpp'],
  unity: ['bundle.cpp', 'normalize.cpp', 'stage.cpp', 'gain.cpp'],
});

/**
 * @param {'separate'|'unity'|'none'} tuMode  which TU population the build declares
 * @returns {{repo: string, tuMode: string, translationUnits: string[]}}
 */
export function buildCorpusRepo({ tuMode = 'none' } = {}) {
  if (!['separate', 'unity', 'none'].includes(tuMode)) {
    throw new Error(`unknown tuMode "${tuMode}" — must be separate, unity or none`);
  }
  const repo = mkdtempSync(join(tmpdir(), `apg-corpus-${tuMode}-`));
  const src = join(repo, 'src');
  mkdirSync(src, { recursive: true });
  for (const f of CORPUS_FILES) copyFileSync(join(CORPUS, f), join(src, f));

  const units = TU_SETS[tuMode] ?? [];
  if (tuMode !== 'none') {
    if (!existsSync(CLANG)) {
      throw new Error(`compile DB requested but no compiler at ${CLANG} — refusing to write a `
        + 'compile_commands.json naming a compiler that is not there, which would degrade every '
        + 'arm for a reason unrelated to the thing under test');
    }
    writeFileSync(join(repo, 'compile_commands.json'), JSON.stringify(
      units.map((f) => ({
        directory: repo.replace(/\\/gu, '/'),
        command: `"${CLANG}" /std:c++17 /c src/${f}`,
        file: join(src, f).replace(/\\/gu, '/'),
      })), null, 2));
  }

  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe' });
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'corpus');
  return { repo, tuMode, translationUnits: units };
}
