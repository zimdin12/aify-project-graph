// EMITTED NODE TYPES BY AST, NOT BY SPELLING.
//
// ⛔ THE SAME DEFECT AS `module-graph.mjs`, ONE FILE AWAY FROM ITS HEADER. That file opens by
// explaining that a cycle gate matching `/from\s+'\.\/packet\.js'/` let a double-quoted import
// through. I then wrote a producer inventory matching `/type:\s*'([A-Z][A-Za-z]+)'/` and called it
// "every literally-emitted type". graph-senior-dev executed it:
//
//     type: 'BuildTarget'        -> ['BuildTarget']
//     type: "UndeclaredType"     -> []
//     "type": "UndeclaredType"   -> []
//     type: `UndeclaredType`     -> []
//
// One spelling of four. A producer switching quote style would have gone green while emitting an
// undeclared type — the exact false-drift failure the inventory exists to prevent.
//
// ⇒ Knowing the lesson, and having it written in an adjacent file by the reviewer who taught it,
// did not stop me repeating it. The remedy is not a third warning: it is parsing, so the property
// is found by its POSITION IN THE SYNTAX TREE rather than by how it happens to be typed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** A `type` key: bare identifier `type:` or the equally valid `"type":` / `'type':`. */
function isTypeKey(name) {
  if (!name) return false;
  if (ts.isIdentifier(name)) return name.text === 'type';
  if (ts.isStringLiteralLike(name)) return name.text === 'type';
  return false;
}

/**
 * Every `type: <string literal>` in one source, wherever it is nested.
 *
 * `ts.isStringLiteralLike` covers single quotes, double quotes AND no-substitution templates in
 * one predicate — the quoting is a lexer detail the tree has already discarded by this point,
 * which is the whole reason to be here rather than in a regex.
 *
 * ⚠ A template WITH substitutions is deliberately not a literal: `type: `${x}Node`` is a computed
 * value and is reported by the computed path below, never silently treated as literal coverage.
 */
export function emittedTypeLiterals(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isTypeKey(node.name) && ts.isStringLiteralLike(node.initializer)) {
      out.push({
        value: node.initializer.text,
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/**
 * Every `type:` whose value the parser can see is NOT a literal — a template with substitutions,
 * an identifier, a call, a conditional.
 *
 * ⛔ THIS EXISTS SO THE LIMITATION IS MEASURED RATHER THAN ASSERTED. The inventory's honesty rests
 * on "computed types are invisible to it". A prose note saying so decays the moment a producer
 * adds one. Counting them turns the caveat into a number that moves.
 */
export function computedTypeSites(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const out = [];

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isTypeKey(node.name) && !ts.isStringLiteralLike(node.initializer)) {
      out.push({
        expression: node.initializer.getText(sf).slice(0, 60),
        line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Every `.js` file under `dir`, recursively. */
export function jsFilesUnder(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) jsFilesUnder(p, out);
    else if (entry.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Inventory the `type:` sites across a set of directories.
 *
 * ⛔ THE POPULATION IS RETURNED, NOT ASSUMED. `filesWalked` and `dirs` travel with the result so a
 * caller reporting "every emitted type is declared" can say over WHAT — a completion claim names
 * its population or it is not made, and an inventory over an empty walk is trivially clean.
 */
export function inventoryEmittedTypes(dirs) {
  const literals = new Map();   // value -> {file, line}
  const computed = [];
  const filesWalked = [];

  for (const dir of dirs) {
    for (const file of jsFilesUnder(dir)) {
      filesWalked.push(file);
      const src = readFileSync(file, 'utf8');
      for (const hit of emittedTypeLiterals(src, file)) {
        if (!literals.has(hit.value)) literals.set(hit.value, { file, line: hit.line });
      }
      for (const hit of computedTypeSites(src, file)) computed.push({ file, ...hit });
    }
  }
  return { literals, computed, filesWalked, dirs };
}

/**
 * The literal types absent from the declared vocabulary, each with where it is emitted.
 *
 * ⛔ EXPORTED SO THE GATE AND ITS OWN NEGATIVE CONTROL RUN THE SAME PREDICATE. A control that
 * proves "the check can say NO" against a reimplementation of the check proves nothing about the
 * check. Feeding a synthetic population through this exact function is what binds the route.
 */
export function undeclaredTypes(literals, declared) {
  return [...literals.entries()]
    .filter(([value]) => !declared.includes(value))
    .map(([value, at]) => `${value} (emitted by ${at.file}:${at.line})`);
}
