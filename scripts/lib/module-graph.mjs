// MODULE EDGES BY AST, NOT BY SPELLING.
//
// ⛔ the reviewer executed this against slice 1: my cycle gate matched
//     /from\s+'\.\/packet\.js'/
// so a single-quoted import turned it red, and this equally real cycle passed all seven
// boundary tests:
//     import { resolvePopulation } from "./packet.js";
//
// That is a gate on SYNTAX SPELLING, not on module reachability. One passing spelling does not
// prove the edge class — the same mistake as every other instrument here that checked a shape
// instead of establishing the route.
//
// ⇒ Parse with TypeScript (already a dependency) and report every specifier a module depends on,
// whatever the quoting and whatever the form: static import, `export … from`, `export * from`,
// and dynamic `import()`. The architectural rule is "islands never depend on the facade", which
// dynamic import violates just as surely as a static one even though it is not an eager cycle.
import { readFileSync } from 'node:fs';
import ts from 'typescript';


// ⛔ ONE RECURSIVE BINDING WALKER, because the reviewer executed the shapes the first AST
// version still missed — one level deeper than the line regex it replaced:
//     topLevelDeclarations('export const { a: { b } } = x;')  => []
//     topLevelDeclarations('export const [a, { b }] = x;')    => ['a']   (lost `b`)
//     topLevelDeclarations('export default function () {}')   => []
// A nested destructured declaration could therefore be BOTH unassigned and newly exported while
// the ledger and the export allowlist stayed green. Same class as the regex, one AST level in.
function bindingNames(name, out = []) {
  if (!name) return out;
  if (ts.isIdentifier(name)) { out.push(name.text); return out; }
  for (const el of (name.elements ?? [])) {
    if (ts.isOmittedExpression(el)) continue;
    bindingNames(el.name ?? el, out);           // element / property, incl. rest and defaults
  }
  for (const p of (name.properties ?? [])) bindingNames(p.name ?? p, out);
  return out;
}

// An anonymous default declaration is invisible to a name-based inventory, so it gets an explicit
// sentinel identity: the ledger must then either assign it or forbid it, rather than not see it.
function defaultSentinel(node) {
  if (ts.isFunctionDeclaration(node)) return '<default:function>';
  if (ts.isClassDeclaration(node)) return '<default:class>';
  return '<default:expression>';
}
const isDefaultExport = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

// Every module specifier this source depends on, with the form it took. Forms are reported
// rather than collapsed so a rule can treat `import()` differently from a static import if it
// ever needs to — but the default is that all of them count as a dependency.
export function moduleSpecifiers(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];

  const push = (spec, form, node) => {
    if (spec && typeof spec === 'string') {
      out.push({ specifier: spec, form, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      push(node.moduleSpecifier.text, 'import', node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      // Covers both `export { x } from '…'` and `export * from '…'`. The re-export form was one
      // of the three spellings dev required in the negative matrix.
      push(node.moduleSpecifier.text, node.exportClause ? 'export-from' : 'export-star', node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      // ⛔ FAIL CLOSED ON A SPECIFIER WE CANNOT READ. dev executed all three:
      //     import(`./packet.js`)            -> [] (template literal, not StringLiteral)
      //     import('./' + 'packet.js')       -> [] (computed)
      //     const p='./packet.js'; import(p) -> [] (indirect)
      // The first is a literal edge in different syntax. The others may be unresolvable — and
      // "could not resolve the specifier" is NOT "there is no dependency". An island with an
      // unreadable dynamic import is reported as such so the boundary gate can refuse it.
      const arg = node.arguments?.[0];
      if (arg && ts.isStringLiteralLike(arg)) push(arg.text, 'dynamic-import', node);
      else push('<unresolved>', 'dynamic-import-unresolved', node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// Every name a module makes reachable from outside. Used to inventory island exports, because a
// slice that exports all 31 of its declarations has widened the API without anyone reviewing it.
export function exportedNames(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = new Set();
  const exported = (node) => node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && exported(node)) {
      names.add(node.name ? node.name.text : defaultSentinel(node));
    } else if (ts.isExportAssignment(node)) {
      names.add('<default:expression>');
    } else if (ts.isVariableStatement(node) && exported(node)) {
      // ⚠ Covers `let`/`var`/destructuring too, which the old line regex could not see. The
      // published claim was about EVERY top-level declaration while the parser recognised three
      // shapes — an enforcement claim broader than its instrument.
      for (const d of node.declarationList.declarations) for (const n of bindingNames(d.name)) names.add(n);
    } else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
      for (const el of node.exportClause.elements) names.add(el.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...names].sort();
}

// Every top-level declaration, exported or not. Replaces the line regex in the authority ledger,
// which recognised only `function`/`class`/`const` and could be evaded by `let`, `var`,
// destructuring, or a generator declaration.
export function topLevelDeclarations(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const names = [];
  for (const node of sf.statements) {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) {
      names.push(node.name ? node.name.text : defaultSentinel(node));
    } else if (ts.isExportAssignment(node)) {
      names.push('<default:expression>');
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) names.push(...bindingNames(d.name));
    }
  }
  return names;
}

export const readSpecifiers = (path) => moduleSpecifiers(readFileSync(path, 'utf8'), path);
export const readExports = (path) => exportedNames(readFileSync(path, 'utf8'), path);
export const readDeclarations = (path) => topLevelDeclarations(readFileSync(path, 'utf8'), path);
