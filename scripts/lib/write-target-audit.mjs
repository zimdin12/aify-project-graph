// DOES THIS FILE CONTAIN A FILESYSTEM WRITE AIMED AT A GIVEN IDENTIFIER?
//
// ⛔ WHY AST AND NOT GREP, for the third time in this repo. A regex for `writeFileSync(join(REPO`
// matches one spelling. `fs.writeFileSync(p)` where `p` was computed three lines earlier does not
// match, and neither does `writeFile`, `appendFileSync`, `cp`, `rename` or `rm`. Every previous
// time I enumerated the spellings I could think of, the language had one more:
//   · a cycle gate matching `from\s+'\./packet\.js'` missed the double-quoted import;
//   · a producer inventory matching `type:\s*'X'` missed three of four quote styles;
//   · and then missed SHORTHAND `{ type }` entirely.
// ⇒ Ask the tree what KIND of node it is. A form I did not think of becomes a visible gap rather
// than a silent zero.
//
// ⚠ WHAT THIS CANNOT SEE, stated because a clean result must not be read as proof of safety:
// indirection. A path passed through a helper, stored on an object, or built in another module is
// invisible here. This is a STRUCTURAL LINT over one file, not a proof of unreachability — the
// real guarantee is that the main workspace's `write()` throws. This audit exists so a regression
// is caught at review time rather than at kill time.
import ts from 'typescript';
import { readFileSync } from 'node:fs';

/**
 * Node's mutating filesystem surface, as NAMES rather than as a hand-kept list of call spellings.
 * A new one is a visible addition here, not a silent hole in a regex.
 */
export const MUTATING_FS_CALLS = new Set([
  'writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'rmSync', 'rm', 'unlinkSync', 'unlink', 'rmdirSync', 'rmdir',
  'renameSync', 'rename', 'copyFileSync', 'copyFile', 'cpSync', 'cp',
  'truncateSync', 'truncate', 'mkdirSync', 'mkdir',
  'createWriteStream', 'openSync', 'writeSync',
]);

const parse = (source, fileName) => {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics?.length) {
    throw new Error(`${fileName} did not parse cleanly (${sf.parseDiagnostics.length} diagnostics) — `
      + 'an audit over an unparsed file would report a reassuring zero');
  }
  return sf;
};

/** The called name, whether `writeFileSync(...)` or `fs.writeFileSync(...)`. */
function calleeName(expr) {
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
  return null;
}

/** Does any identifier anywhere inside this node match `name`? */
function mentions(node, name) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (ts.isIdentifier(n) && n.text === name) { found = true; return; }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return found;
}

/**
 * Every mutating fs call in `source` whose FIRST argument mentions `identifier`.
 *
 * @returns {{call: string, identifier: string, line: number, text: string}[]}
 */
export function writesTargeting(source, identifier, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const hits = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && MUTATING_FS_CALLS.has(name) && node.arguments.length > 0
          && mentions(node.arguments[0], identifier)) {
        hits.push({
          call: name,
          identifier,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export const writesTargetingFile = (path, identifier) =>
  writesTargeting(readFileSync(path, 'utf8'), identifier, path);

/**
 * The rule this repo actually needs: writes into the main checkout are permitted ONLY under the
 * run-evidence directory. Everything else -- a mutation, a restore -- must go through a workspace.
 *
 * DERIVED FROM THE RULE, NOT A LIST OF BLESSED LINE NUMBERS. An allowlist of call sites is a list
 * someone must remember to update, which is a defect with a delay on it: the thirty-first arm gets
 * added, the list does not, and the exemption silently covers the new call too.
 *
 * @param allowedRoots string literals that mark a permitted destination (e.g. '.self-review-raw')
 */
export function writesTargetingOutside(source, identifier, allowedRoots, fileName = 'x.mjs') {
  return writesTargeting(source, identifier, fileName).filter(
    (h) => !allowedRoots.some((root) => h.text.includes(root)),
  );
}
