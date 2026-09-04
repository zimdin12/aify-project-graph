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
    why: '⚠ THIS JUSTIFICATION EXPIRED THE DAY IT WAS WRITTEN, and is corrected here rather than '
      + 'left standing. It said the population was empty because mutation controls "are written ad '
      + 'hoc in the operator scratchpad and are never committed". scripts/lib/mutation-control.mjs '
      + 'was committed the same session, so a committed population now exists — one member. '
      + 'Flagged in field testing, applying the rule this project already holds: that a description '
      + 'must not '
      + 'outlive the behaviour it describes. The category stays unimplemented because ONE member is '
      + 'not a corpus worth a detector, but that is a different and much weaker reason than the one '
      + 'it replaces, and it stops being true the moment a second harness lands.',
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
/**
 * ⛔⛔ ONE PAIR OF PARENTHESES DEFEATED EVERY RULE IN THIS FUNCTION.
 *
 *     return xs.every(p);      DETECTED
 *     return (xs.every(p));    MISSED
 *     e.ok = (xs.every(p));    MISSED
 *
 * `node.parent` became a ParenthesizedExpression, so return / assignment / arrow / if / ternary all
 * stopped matching AT ONCE. That is not one more context to enumerate — it is the SAME context
 * wearing a transparent wrapper, it is semantically identical, and formatters add and remove them.
 *
 * ⇒ EVERY CONTEXT ADDED LATER WOULD HAVE INHERITED THE HOLE. So the wrapper is stripped before
 * anything is classified, and one unwrapping step repairs three probe cases plus every future rule.
 *
 * ⚠ AND IT CHANGED WHAT THE EXISTING CONTROLS PROVED. They all use unparenthesized source, so they
 * could not distinguish "handles assignment" from "handles assignment as long as nobody wrapped it".
 *
 * ⚠ `await` is treated the same way. The comma operator is NOT blanket-transparent: only the RIGHT
 * operand's value flows out, so the left is deliberately not unwrapped.
 *
 * Found in field testing, running 24 constructs as a corpus rather than imagining cases.
 */
function unwrapTransparent(node) {
  let cur = node;
  for (;;) {
    const parent = cur.parent;
    if (!parent) return cur;
    if (ts.isParenthesizedExpression(parent) || ts.isAwaitExpression(parent)) { cur = parent; continue; }
    if (ts.isBinaryExpression(parent)
        && parent.operatorToken.kind === ts.SyntaxKind.CommaToken
        && parent.right === cur) { cur = parent; continue; }
    return cur;
  }
}

/**
 * Callees whose ARGUMENT is a verdict rather than data.
 *
 * ⚠ ENUMERATION, KNOWINGLY — and the argument for it is the field test's: `console.log(xs.every(p))` is
 * data and `assert(xs.every(p))` is a verdict, so a blanket argument rule would be wrong. But
 * leaving arguments out entirely is not neutral: it makes a vacuous quantifier INSIDE AN ASSERTION
 * invisible, which is where a vacuous `true` does the most damage — a test passing over an empty
 * population. This is enumeration over a much smaller and slower-moving set than syntax.
 */
const VERDICT_CALLEES = new Set(['assert', 'expect', 'invariant', 'ok', 'require', 'strictEqual']);

function gateContext(rawNode) {
  const node = unwrapTransparent(rawNode);
  const p = node.parent;
  if (!p) return null;
  if (ts.isWhileStatement(p) && p.expression === node) return 'while-condition';
  if (ts.isDoStatement(p) && p.expression === node) return 'do-while-condition';
  if (ts.isSwitchStatement(p) && p.expression === node) return 'switch-discriminant';
  // A class property initialiser is the same act as an assignment, with a different node type.
  if (ts.isPropertyDeclaration(p) && p.initializer === node) return `assigned to class field \`${p.name.getText()}\``;
  if (ts.isCallExpression(p) && p.arguments.includes(node)) {
    const callee = ts.isPropertyAccessExpression(p.expression) ? p.expression.expression.getText()
      : p.expression.getText();
    if (VERDICT_CALLEES.has(String(callee).split('.').pop())) return `argument to ${callee}()`;
  }
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
    // ⛔ `&&=` `||=` `??=` ARE ASSIGNMENTS TOO, and testing EqualsToken alone missed all three —
    // the same shape as the defect that motivated this tool, one token class over.
    const ASSIGN = new Set([
      ts.SyntaxKind.EqualsToken,
      ts.SyntaxKind.AmpersandAmpersandEqualsToken,
      ts.SyntaxKind.BarBarEqualsToken,
      ts.SyntaxKind.QuestionQuestionEqualsToken,
    ]);
    if (ASSIGN.has(p.operatorToken.kind) && p.right === node) {
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
// 2b. EMPTY CATCH THAT KEEPS AN OPTIMISTIC DEFAULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A catch with NO statements, sitting over a try that assigned to a variable declared outside it.
 *
 * ⛔⛔ ADDED BECAUSE THE RULE ABOVE COULD NOT MATCH THE DEFECT THE CLASS IS NAMED AFTER.
 * `failOpenCatches` requires a body of exactly one return, and `FINDING-contract-failed-open` — the
 * first instance the roadmap lists under PATTERN A — is an empty body:
 *
 *     let line = '';
 *     try { line = '\n' + await buildAbsenceTrustLine({ ... }); }
 *     catch { \/* defensive *\/ }
 *
 * On failure `line` keeps `''` and the answer ships as a bare `NO CALLERS` with no TRUST, no SCOPE
 * and no NOT MODELLED — byte-identical to a build without the feature. Audited with
 * `git show <fix>^:<file>`: the old rule scored 0 hits on both flagship pre-fix files.
 *
 * ⚠ THE DISCRIMINATOR IS THE OUTER ASSIGNMENT, NOT THE EMPTINESS, and the rate is why. Measured
 * across mcp + scripts: 607 try/catch, 193 empty bodies (31.8%), 71 of those assigning to an outer
 * name (11.7%). Flagging emptiness alone would nearly triple the candidate set to catch nothing
 * extra — and a detector that flags everything gets muted, which is worse than absent because it
 * looks like coverage.
 *
 * ⚠ A CANDIDATE, NOT A DEFECT, exactly like every other rule here. `catch {}` over a best-effort
 * assignment is often right. The value is the question: can a caller tell the kept value apart from
 * a genuine one?
 */
export function emptyCatchKeepsDefault(source, fileName = 'x.mjs') {
  const sf = parse(source, fileName);
  const hits = [];
  const visit = (node) => {
    if (ts.isTryStatement(node) && node.catchClause
        && node.catchClause.block.statements.length === 0) {
      // A name declared INSIDE the try does not survive it, so it cannot carry a default outward.
      const declaredInTry = new Set();
      const assigned = [];
      const scan = (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) declaredInTry.add(n.name.text);
        if (ts.isBinaryExpression(n)
          && n.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isIdentifier(n.left)
          && !assigned.includes(n.left.text)) assigned.push(n.left.text);
        ts.forEachChild(n, scan);
      };
      scan(node.tryBlock);
      const keeps = assigned.filter((a) => !declaredInTry.has(a));
      if (keeps.length > 0) {
        hits.push({
          category: 'empty-catch-keeps-default',
          keeps,
          line: at(sf, node),
          text: snippet(sf, node),
          question: `on failure ${keeps.join(', ')} ${keeps.length === 1 ? 'is' : 'are'} left at the `
            + 'value it held before the try, and the catch says nothing. Can a caller tell that '
            + 'apart from a genuine result?',
        });
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
