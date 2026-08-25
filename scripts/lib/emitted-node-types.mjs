// EMITTED NODE TYPES BY AST, NOT BY SPELLING.
//
// ⛔ ROUND 1 — THE SAME DEFECT AS `module-graph.mjs`, ONE FILE AWAY FROM ITS HEADER. That file opens
// by explaining that a cycle gate matching `/from\s+'\.\/packet\.js'/` let a double-quoted import
// through. I then wrote a producer inventory matching `/type:\s*'([A-Z][A-Za-z]+)'/` and called it
// "every literally-emitted type". the reviewer executed it: `type: "X"`, `"type": "X"` and
// `` type: `X` `` all returned nothing. One spelling of four, described as the class.
//
// ⛔⛔ ROUND 2 — AND THEN I BOUND A FALSE POPULATION INSIDE THE FIX FOR FALSE POPULATIONS. Having
// replaced the regex, I asserted "5 computed sites" as a MEASURED number. It counted explicit
// `type: <expr>` property assignments only. Two live node constructors use SHORTHAND:
//
//     mcp/stdio/ingest/extractors/generic.js:243    return { id, type, label, ... }
//     mcp/stdio/ingest/sweep.js:46                  const base = { id, type, label, ... }
//
// Both emit nodes. The true minimum was 7. ⇒ **The instrument I built to stop numbers being
// asserted over populations they cannot see, asserted a number over a population it could not see.**
// A count is not evidence of coverage; it is evidence of what the walker happens to visit.
//
// ⇒ THE STRUCTURAL LESSON, WHICH IS WHY THE WALK IS NOW ONE FUNCTION: shorthand and explicit are
// the same emission wearing different syntax, exactly as the four quote styles were. Each time I
// enumerated the forms I could think of, and each time the language had one more. Enumerating
// syntax is the losing move — ask the tree what KIND of node it is and handle the kinds, so a form
// I did not think of is a visible gap rather than a silent zero.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/**
 * Parse, or refuse.
 *
 * ⛔ FAIL CLOSED ON A PARTIAL TREE. `ts.createSourceFile` never throws: given malformed source it
 * returns whatever it managed to build. Measured on `const n = { type: ;;; oops(((` — three parse
 * diagnostics, and the old helpers happily returned a result from the wreckage.
 *
 * That is the failure this repo keeps paying for: an unreadable input yielding a SMALLER inventory
 * and a GREEN gate. A file the parser cannot read is unknown coverage, never zero emissions.
 */
export function parseProducerSource(source, fileName = 'x.js') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = sf.parseDiagnostics ?? [];
  if (diagnostics.length > 0) {
    const first = diagnostics[0];
    const { line } = sf.getLineAndCharacterOfPosition(first.start ?? 0);
    const text = ts.flattenDiagnosticMessageText(first.messageText, ' ');
    throw new Error(
      `refusing to inventory ${fileName}: ${diagnostics.length} parse diagnostic(s), ` +
      `first at line ${line + 1}: ${text}. An unparseable producer is UNKNOWN coverage, not zero.`,
    );
  }
  return sf;
}

/** A `type` key: bare identifier `type:` or the equally valid `"type":` / `'type':`. */
function isTypeKey(name) {
  if (!name) return false;
  if (ts.isIdentifier(name)) return name.text === 'type';
  if (ts.isStringLiteralLike(name)) return name.text === 'type';
  return false;
}

/**
 * Every `type` site in one source, partitioned into what the syntax CAN tell us and what it cannot.
 *
 * ONE WALK, THREE NODE KINDS — the partition is by what the tree says, not by which spellings I
 * managed to list:
 *
 *   PropertyAssignment      + string-literal-like value  -> LITERAL   (value is knowable here)
 *   PropertyAssignment      + any other value            -> COMPUTED  (`type: detectedType`)
 *   ShorthandPropertyAssignment                          -> COMPUTED  (`{ type }` — a variable)
 *
 * ⚠ `ts.isStringLiteralLike` collapses single quotes, double quotes and no-substitution templates,
 * because by this point quoting is a lexer detail the tree has already discarded. A template WITH
 * substitutions is deliberately NOT literal: `` type: `${x}Node` `` is computed and is reported as
 * such rather than counted as literal coverage.
 */
export function typeSites(source, fileName = 'x.js') {
  const sf = parseProducerSource(source, fileName);
  const literals = [];
  const computed = [];
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;

  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && isTypeKey(node.name)) {
      if (ts.isStringLiteralLike(node.initializer)) {
        literals.push({ value: node.initializer.text, line: lineOf(node) });
      } else {
        computed.push({ expression: node.initializer.getText(sf).slice(0, 60), line: lineOf(node), form: 'property' });
      }
    } else if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'type') {
      // `{ id, type, label }` — the value is whatever the binding holds, which the syntax cannot say.
      computed.push({ expression: 'type', line: lineOf(node), form: 'shorthand' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { literals, computed };
}

/** Every `type: <string literal>` in one source. */
export function emittedTypeLiterals(source, fileName = 'x.js') {
  return typeSites(source, fileName).literals;
}

/**
 * Every `type` site whose value the syntax cannot resolve — computed property values AND shorthand.
 *
 * ⛔ COUNTED, NOT ASSERTED. The inventory's honesty rests on "computed types are invisible to it".
 * Prose saying so decays the moment a producer adds one; a number moves. That is only true if the
 * number covers the same population the claim does — which is precisely what round 2 got wrong.
 */
export function computedTypeSites(source, fileName = 'x.js') {
  return typeSites(source, fileName).computed;
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
 * Inventory the `type` sites across a set of directories.
 *
 * ⛔ THE POPULATION IS RETURNED, NOT ASSUMED. `filesWalked` and `dirs` travel with the result so a
 * caller reporting "every emitted type is declared" can say over WHAT — a completion claim names
 * its population or it is not made, and an inventory over an empty walk is trivially clean.
 *
 * ⛔ AND IT DOES NOT SWALLOW A PARSE FAILURE. `parseProducerSource` throws; nothing here catches it.
 * A producer that stops parsing must break the gate, not shrink the denominator.
 */
export function inventoryEmittedTypes(dirs) {
  const literals = new Map();   // value -> {file, line}
  const computed = [];
  const filesWalked = [];

  for (const dir of dirs) {
    for (const file of jsFilesUnder(dir)) {
      filesWalked.push(file);
      const sites = typeSites(readFileSync(file, 'utf8'), file);
      for (const hit of sites.literals) {
        if (!literals.has(hit.value)) literals.set(hit.value, { file, line: hit.line });
      }
      for (const hit of sites.computed) computed.push({ file, ...hit });
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
