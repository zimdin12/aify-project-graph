// A REFUSAL IS A CLAIM, AND A CLAIM MUST NAME ITS POPULATION.
//
// ⛔ `NO MATCH for "X"` is read as a fact about the repository. It is not one. It is a fact
// about the rows this verb queried — a filtered slice of an index built by an extractor that
// does not see everything. When those two differ, the reader acts on a false negative and has
// no way to detect it, which is the most expensive kind of wrong answer this tool can give:
// the agent concludes the symbol does not exist and stops looking.
//
// ⇒ MEASURED (2026-08-19), on this repo's own graph: 84 of 89 `export const NAME = …` names in
// `mcp/` have no declaration node, and the node-type histogram has NO `Variable` row at all.
// Tree-sitter extraction has no path that emits one; the only producer is the code-intel
// importer, which needs a collection most repos do not have. So `graph_whereis("SEARCH_TYPES")`
// — a constant declared in whereis.js itself — answers NO MATCH.
//
// ★ SCOPE THE DOUBT TO ITS CAUSE, exactly as tightly as a claim. A blanket "results may be
// incomplete" costs the reader the same as a false statement, because they go and verify
// either way. So this does not hedge: it names the types searched, and it names which of them
// are EMPTY IN THIS GRAPH — a checkable fact the reader can act on. When nothing is empty it
// says nothing about emptiness, because a manufactured doubt is its own defect.
//
// ⚠ The empty-type list is computed from the SAME `types` the caller queried. Passing one list
// to the query and another to this function is how the disclosure and the search drift apart
// later; callers derive both from a single constant.

// One indexed GROUP BY over a column that is already indexed. This runs only on the miss path,
// where a round-trip is cheaper than sending the reader to grep the whole repository.
export function emptyTypesAmong(db, types) {
  if (!db || !Array.isArray(types) || types.length === 0) return [];
  try {
    const quoted = types.map((t) => `'${String(t).replace(/'/g, "''")}'`).join(',');
    const present = new Set(
      db.all(`SELECT DISTINCT type FROM nodes WHERE type IN (${quoted})`).map((r) => r.type),
    );
    return types.filter((t) => !present.has(t));
  } catch {
    // A disclosure must never turn a clean not-found into an error. Losing the empty-type
    // detail is survivable; losing the answer is not. The population sentence still renders.
    return [];
  }
}

// Types this verb does NOT search but which HAVE nodes here. the field test's point, and it is
// symmetrical to the empty-type list: for a reader deciding "can this verb find my thing", a
// present-but-excluded type is exactly as decisive as a declared-but-empty one — and unlike the
// first it is currently invisible. On echoes that hides 183 `Symbol` nodes and 1 `BuildTest`.
//
// ⚠ SCOPED, because listing every excluded type would be noise rather than disclosure. These
// are excluded from the report by construction: File/Directory/Document/Config are answered by
// the path branch, Module is a file-level container, and External is a reference stub, not a
// declaration. What survives is the genuinely surprising remainder — the kinds a reader could
// reasonably expect a declaration lookup to cover and which it silently does not.
const NOT_DECLARATION_SHAPED = new Set([
  'File', 'Directory', 'Document', 'Config', 'Module', 'External', 'Repository',
]);

export function presentButUnsearched(db, types) {
  if (!db || !Array.isArray(types)) return [];
  try {
    const searched = new Set(types);
    return db.all('SELECT type, count(*) AS n FROM nodes GROUP BY type')
      .filter((r) => !searched.has(r.type) && !NOT_DECLARATION_SHAPED.has(r.type) && r.n > 0)
      .sort((a, b) => b.n - a.n)
      .map((r) => `${r.type} (${r.n})`);
  } catch {
    return [];
  }
}

// The note appended to a miss. `what` names the table in the reader's language ("declaration
// types"), and is deliberately a caller argument: verbs search different populations, and one
// shared sentence that fits none of them is how a generic warning gets ignored.
/**
 * The scope note for a verb that searched EVERY node type.
 *
 * ⛔ `missScopeNote` cannot serve this case: it names WHICH declaration types were searched, and a
 * verb with no type filter has no such list — it returns '' for an empty `types`, which is how
 * graph_path and graph_explore ended up answering a BARE "NO MATCH". Found 2026-09-03 by a
 * whole-surface census; they were the last two of 13 absence-emitting verb files with no scope
 * statement at all.
 *
 * ⚠ AND THE REMEDY THEY OFFERED WAS ALREADY KNOWN-INERT. Their only next step was
 * `Try graph_search(...)`, and the comment in missScopeNote above records why that fails for
 * exactly this case: graph_search queries the SAME node table, so a symbol that was never indexed
 * cannot be found by a second verb that reads the same rows. It was confirmed live in the field on
 * `kEquatorLatBandsPerShell`. A remedy that cannot change the answer is the defect this repo
 * already removed from did-you-mean.
 *
 * Kept to one line on purpose: a 359-byte clause shipped earlier today measured 79% of a bare
 * NO MATCH answer and had to be cut. This fires only on an absence.
 */
export function allTypesMissNote() {
  return '⚠ A STATEMENT ABOUT THIS GRAPH, NOT THE REPOSITORY: every node type was searched, so a '
    + 'symbol that was never indexed is invisible to every verb here — read the source file.';
}

export function missScopeNote(db, { types, what = 'declaration types' } = {}) {
  if (!Array.isArray(types) || types.length === 0) return '';
  const empty = emptyTypesAmong(db, types);
  const lines = [
    `⚠ THIS IS A STATEMENT ABOUT THIS GRAPH'S ${what.toUpperCase()}, NOT ABOUT THE REPOSITORY. `
      + `Searched ${what}: ${types.join(', ')}.`,
  ];
  if (empty.length > 0) {
    // ⛔ THE REMEDY NAMED A DOOR THAT CANNOT OPEN FOR THE CASE IT HAD JUST DIAGNOSED.
    // the field test followed it: this line said "use graph_search", and graph_search reads the SAME
    // node table — so a constant that is not a node cannot be found by a second verb that
    // queries nodes. Confirmed live on echoes: kEquatorLatBandsPerShell exists at
    // CylindricalPosition.h:102 and graph_search returns NO RESULTS.
    // ⇒ When an empty type explains the miss, the source file is the ONLY thing that answers.
    lines.push(
      `⛔ ${empty.length} of those ${types.length} have NO nodes in this graph at all `
        + `(${empty.join(', ')}) — a symbol of those kinds cannot be found by this verb here, `
        + 'whether or not it exists in the source. READ THE SOURCE FILE: graph_search queries '
        + 'the same node table and cannot find what was never indexed.',
    );
  }
  const unsearched = presentButUnsearched(db, types);
  if (unsearched.length > 0) {
    lines.push(
      `⚠ And ${unsearched.length} populated type${unsearched.length === 1 ? ' is' : 's are'} `
        + `NOT searched by this verb at all: ${unsearched.join(', ')}. Those nodes exist here and `
        + 'this verb will never return them.',
    );
  }
  return lines.join('\n');
}

/**
 * Name the population the heuristic graph searched.
 *
 * ⛔ ONE OWNER FOR THE NUMBER AND THE LIMIT. It is rendered on two different surfaces — the
 * empty-set absence (`buildAbsenceTrustLine`) and the NO MATCH message shared by nine verbs — and
 * the two would otherwise drift into disagreeing about the same fact, which is the failure this
 * repo already records for dirty-file counts ("one verb said 592, another said 4").
 *
 * ⛔ M2: "separate 'no callers in indexed scope' from 'no callers' and NAME the scope". Measured
 * absent on both absence shapes before this existed.
 * See docs/evidence/m2-contract/FINDING-absence-does-not-name-the-indexed-scope.md
 *
 * ⚠ TWO LENGTHS, AND THE SHORT ONE IS A MEASURED DECISION, not a stylistic preference. Real NO MATCH
 * answers on this repository are 251-281 B; the full wording is 26-28% of the smallest, over the 25%
 * budget fixed before the numbers existed, while `brief` is 17.4%. ⚠ The brief form still carries the
 * limit clause — a bare count invites exactly the completeness reading the limit exists to block,
 * and NO MATCH has no TRUST line beside it to supply that elsewhere.
 *
 * ⛔ NUMERATOR ONLY. A denominator would need a repo walk these paths do not do, and a fabricated one
 * lets a reader compute a completeness figure nobody measured.
 *
 * ⚠ SILENT ON AN UNREADABLE COUNT, never "0 files": a failed query must not render as a measured
 * empty graph.
 */
// ⭐ THE COUNT HAS ONE OWNER, AND CALLERS THAT WANT THE NUMBER TAKE IT FROM HERE.
//
// `graph_callers` now states the scope in its HEADLINE rather than in the clause below, and the
// obvious way to do that — a second `SELECT COUNT(*) ... WHERE type = 'File'` in callers.js — is the
// mistake this project made three times in one evening: writing a helper that already existed.
// Two counts of one population drift, and the drift is invisible because both look plausible.
//
// ⚠ `null` MEANS "COULD NOT COUNT" AND IS NOT ZERO. A failed COUNT must never become
// "INDEXED SCOPE: 0 files", which reads as a measured empty graph. Both consumers below must treat
// null as "say nothing" rather than as a number.
export function indexedFileCount(db) {
  if (!db) return null;
  try {
    const files = db.get(`SELECT COUNT(*) AS c FROM nodes WHERE type = 'File'`)?.c ?? null;
    return (typeof files === 'number' && files > 0) ? files : null;
  } catch { return null; }
}

/** The scope fact as a HEADLINE fragment: "in 939 indexed files (not the whole repository)". */
export function indexedScopePhrase(db) {
  const files = indexedFileCount(db);
  if (files === null) return '';
  return ` in ${files} indexed file${files === 1 ? '' : 's'} (not the whole repository)`;
}

export function indexedScopeClause(db, { brief = false } = {}) {
  const files = indexedFileCount(db);
  if (files === null) return '';
  const noun = `${files} file${files === 1 ? '' : 's'}`;
  // ⛔ ONE WORDING NOW, AND THE LONG ONE IS GONE. `brief` was introduced for the NO MATCH surface
  // after measuring that it still carries the limit — "not the whole repository" is the whole
  // guarantee the long form spent 48 more bytes to make. Keeping two wordings of one fact was paying
  // for a distinction that measurement had already dissolved, on a surface this project had just
  // measured as 2.4x the warning wall it once removed.
  //
  // ⚠ The parameter is kept so callers do not all have to change and so the budget gate keeps its
  // two named surfaces; both branches deliberately produce the same text.
  void brief;
  return ` INDEXED SCOPE: ${noun} — not the whole repository.`;
}
