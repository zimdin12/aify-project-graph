// AN INVENTORY OF CANDIDATE HAZARDS. NOT A VERDICT, NOT AN AUTHORITY, NOT AUTO-FIXED.
//
// ⛔ WHY THIS EXISTS. In one day I shipped four assertions that PASSED while proving nothing, all
// the same shape, none visible from the green:
//   1. `excluded.every(pred)` in refactor-guard — `[].every()` is TRUE, so when the matcher stopped
//      matching, the wired FAIL path became unreachable and the artifact asserted health over 61
//      inert rows for the entire life of the tool;
//   2. `stillBlocksNewRuns: true` — a hardcoded literal, a field reporting itself, which meant
//      reverting the predicate it claimed to reflect turned only one test red;
//   3. `snapshotLine(REPO)` — wrong arity, so both compared fields came back `?`, `differs` was
//      always false, and the assertion reduced to `false === false`;
//   4. a negative control matching /hooks\s+DISABLED/ instead of the row, so an unconditional
//      renderer emitting `hooks undefined` sailed through.
// Each was caught by running a control, never by reading the code. Four in a day is a class, and a
// class deserves a mechanical control rather than more attention.
//
// ⛔⛔ EVERY MATCH IS A CANDIDATE FOR ADJUDICATION, NEVER A PROVEN DEFECT. Plenty of `.every()`
// calls are correct because their population cannot be empty, and plenty of `catch { return 0 }`
// are correct because zero is the true answer. This tool finds SHAPES; a human decides. Reporting
// a count as a defect total would be the same error it exists to catch.
//
// ⚠ AND ITS BLIND SPOTS ARE NAMED IN `NOT_IMPLEMENTED` below rather than left for someone to
// discover as a silent zero.
import ts from 'typescript';

/**
 * ⛔ TWO OF THE REFEREE'S SIX CATEGORIES ARE DELIBERATELY NOT IMPLEMENTED, and saying so is part of
 * the deliverable. A tool that reports on four categories while its name implies six produces
 * exactly the false-completeness this repo keeps paying for.
 */
export const NOT_IMPLEMENTED = Object.freeze([
  {
    category: 'assertions comparing values derived from the same producer on both sides',
    why: 'deciding that two expressions share a producer needs data-flow analysis, not syntax. A '
      + 'syntactic version would flag every `expect(f(x)).toBe(g(x))` and miss the real cases where '
      + 'the shared origin is three calls away. A high-noise detector gets muted, and a muted '
      + 'detector is worse than an absent one because it looks like coverage.',
  },
  {
    category: 'mutation controls lacking a unique-site count, an applied-edit assertion, or a predicted red',
    why: 'the population is empty in this repository. Mutation controls are written ad hoc in the '
      + 'operator scratchpad and are never committed, so there is nothing here to scan. Implementing '
      + 'it would produce a permanent, reassuring zero over a population that does not exist — the '
      + 'exact defect shape this inventory is for.',
  },
]);

const parse = (source, fileName) => {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (sf.parseDiagnostics?.length) {
    throw new Error(`${fileName} did not parse cleanly — an inventory over an unparsed file would `
      + 'report a reassuring zero');
  }
  return sf;
};

const at = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
const snippet = (sf, node, n = 110) => node.getText(sf).replace(/\s+/g, ' ').slice(0, n);

// ─────────────────────────────────────────────────────────────────────────────
// 1. QUANTIFIERS OVER A POSSIBLY-EMPTY POPULATION
// ─────────────────────────────────────────────────────────────────────────────

/** `[].every(p)` is TRUE and `[].some(p)` is FALSE. Both are answers nobody computed. */
const VACUOUS_QUANTIFIERS = new Set(['every', 'some']);

/**
 * Is this quantifier being used as a GATE — its value deciding something — rather than as data?
 *
 * ⚠ This is the difference between a hazard and a line of code. `xs.every(p)` logged to a console
 * is harmless; the same call returned from `isHealthy()` is a verdict.
 */
function gateContext(node) {
  const p = node.parent;
  if (!p) return null;
  if (ts.isReturnStatement(p)) return 'returned';
  if (ts.isIfStatement(p) && p.expression === node) return 'if-condition';
  if (ts.isConditionalExpression(p) && p.condition === node) return 'ternary-condition';
  if (ts.isPropertyAssignment(p)) return `assigned to property \`${p.name.getText()}\``;
  if (ts.isVariableDeclaration(p)) return `assigned to \`${p.name.getText()}\``;
  if (ts.isBinaryExpression(p)) {
    // ⛔⛔ THE CONTEXT I FORGOT, AND IT IS THE ONE THE TOOL WAS BUILT FOR. The original defect was
    // `entry.volatileShapeOk = excluded.every(...)` — a plain ASSIGNMENT, which is a BinaryExpression
    // with an `=` token, not a VariableDeclaration and not a PropertyAssignment. My first version
    // handled declarations and object literals and missed assignment entirely, so running it against
    // the pre-fix source returned ZERO while the defect sat there twice.
    //
    // ⇒ The detector for vacuous checks was itself unable to see the vacuous check it exists for,
    // and the live-instance control PASSED, so nothing would have revealed it. Enumerating the
    // contexts I could think of is the same losing move as enumerating syntax.
    if (p.operatorToken.kind === ts.SyntaxKind.EqualsToken && p.right === node) {
      return `assigned to ${p.left.getText().slice(0, 40)}`;
    }
    if (['&&', '||', '??'].includes(p.operatorToken.getText())) return 'boolean operand';
    if (['===', '!==', '==', '!='].includes(p.operatorToken.getText())) return 'compared';
  }
  if (ts.isPrefixUnaryExpression(p) && p.operator === ts.SyntaxKind.ExclamationToken) return 'negated';
  if (ts.isArrowFunction(p) && p.body === node) return 'arrow body (returned)';
  return null;
}

export function vacuousQuantifiers(source, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const hits = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && VACUOUS_QUANTIFIERS.has(node.expression.name.text)) {
      const context = gateContext(node);
      if (context) {
        hits.push({
          category: 'vacuous-quantifier',
          quantifier: node.expression.name.text,
          receiver: node.expression.expression.getText(sf).slice(0, 60),
          context,
          line: at(sf, node),
          text: snippet(sf, node),
          question: `if ${node.expression.expression.getText(sf).slice(0, 40)} is EMPTY, this yields `
            + `${node.expression.name.text === 'every' ? 'true' : 'false'} — is that the right answer, `
            + 'and is emptiness possible here?',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. FAIL-OPEN CATCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A catch whose whole body returns a value that reads as SUCCESS.
 *
 * ⛔ THE LIVE INSTANCE: `safeDirtyCount` is `try { ... } catch { return 0; }`, so a failed git query
 * reports ZERO DIRTY FILES — indistinguishable from a clean tree — while the same output line
 * already uses `?` for an unknown commit. The honest marker existed and this field ignored it.
 */
function successLiteral(expr) {
  if (!expr) return null;
  if (ts.isNumericLiteral(expr) && expr.text === '0') return '0';
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (ts.isArrayLiteralExpression(expr) && expr.elements.length === 0) return '[]';
  if (ts.isObjectLiteralExpression(expr) && expr.properties.length === 0) return '{}';
  if (ts.isStringLiteralLike(expr) && expr.text === '') return "''";
  return null;
}

export function failOpenCatches(source, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const hits = [];
  const visit = (node) => {
    if (ts.isCatchClause(node)) {
      const stmts = node.block.statements;
      if (stmts.length === 1 && ts.isReturnStatement(stmts[0])) {
        const lit = successLiteral(stmts[0].expression);
        if (lit) {
          hits.push({
            category: 'fail-open-catch',
            returns: lit,
            line: at(sf, node),
            text: snippet(sf, node),
            question: `a failure here is reported as ${lit}. Can a caller tell that apart from a `
              + 'genuine ' + lit + '? If not, the error is invisible and reads as success.',
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. SELF-REPORTING LITERAL FIELDS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A property assigned a hardcoded literal whose key is never read anywhere in the corpus.
 *
 * ⛔ THE LIVE INSTANCE: `stillBlocksNewRuns: true`. A field reporting itself is disclosure, not a
 * control — reverting the predicate it claimed to reflect turned only ONE test red, because nothing
 * READ the predicate. Deriving it made the same control turn two red.
 *
 * ⚠ HEURISTIC, AND NOISY BY DESIGN. "Never read" is approximated by the key name not appearing
 * elsewhere in the scanned corpus, which misses dynamic access and over-reports one-off config. It
 * is a prompt to go and check, not a finding.
 */
export function selfReportingLiterals(source, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const hits = [];
  const visit = (node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const lit = node.initializer.kind === ts.SyntaxKind.TrueKeyword ? 'true'
        : node.initializer.kind === ts.SyntaxKind.FalseKeyword ? 'false'
          : ts.isNumericLiteral(node.initializer) ? node.initializer.text : null;
      if (lit !== null) {
        hits.push({
          category: 'self-reporting-literal',
          key: node.name.text,
          value: lit,
          line: at(sf, node),
          text: snippet(sf, node),
          question: `\`${node.name.text}\` is a constant. Does anything DECIDE on it, or does it only `
            + 'describe itself? A field that reports itself cannot fail with the thing it describes.',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Names that appear as a READ somewhere in the corpus — used to filter category 6 down. */
export function readKeys(source, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const names = new Set();
  const visit = (node) => {
    // A property ACCESS (`x.foo`) or a shorthand/destructured read, but not the assignment itself.
    if (ts.isPropertyAccessExpression(node)) names.add(node.name.text);
    else if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.add(node.name.text);
    else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
      names.add(node.argumentExpression.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return names;
}

export const DETECTORS = Object.freeze({
  'vacuous-quantifier': vacuousQuantifiers,
  'fail-open-catch': failOpenCatches,
  'self-reporting-literal': selfReportingLiterals,
});
