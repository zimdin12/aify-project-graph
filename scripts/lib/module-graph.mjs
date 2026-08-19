// MODULE EDGES BY AST, NOT BY SPELLING.
//
// ⛔ graph-senior-dev executed this against slice 1: my cycle gate matched
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
      const arg = node.arguments?.[0];
      if (arg && ts.isStringLiteral(arg)) push(arg.text, 'dynamic-import', node);
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
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && exported(node) && node.name) {
      names.add(node.name.text);
    } else if (ts.isVariableStatement(node) && exported(node)) {
      // ⚠ Covers `let`/`var`/destructuring too, which the old line regex could not see. The
      // published claim was about EVERY top-level declaration while the parser recognised three
      // shapes — an enforcement claim broader than its instrument.
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.add(d.name.text);
        else for (const el of (d.name.elements ?? [])) {
          if (el.name && ts.isIdentifier(el.name)) names.add(el.name.text);
        }
      }
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
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.push(node.name.text);
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
        else for (const el of (d.name.elements ?? [])) {
          if (el.name && ts.isIdentifier(el.name)) names.push(el.name.text);
        }
      }
    }
  }
  return names;
}

export const readSpecifiers = (path) => moduleSpecifiers(readFileSync(path, 'utf8'), path);
export const readExports = (path) => exportedNames(readFileSync(path, 'utf8'), path);
export const readDeclarations = (path) => topLevelDeclarations(readFileSync(path, 'utf8'), path);
