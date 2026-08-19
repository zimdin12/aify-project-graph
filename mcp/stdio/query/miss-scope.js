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

// The note appended to a miss. `what` names the table in the reader's language ("declaration
// types"), and is deliberately a caller argument: verbs search different populations, and one
// shared sentence that fits none of them is how a generic warning gets ignored.
export function missScopeNote(db, { types, what = 'declaration types' } = {}) {
  if (!Array.isArray(types) || types.length === 0) return '';
  const empty = emptyTypesAmong(db, types);
  const lines = [
    `⚠ THIS IS A STATEMENT ABOUT THIS GRAPH'S ${what.toUpperCase()}, NOT ABOUT THE REPOSITORY. `
      + `Searched ${what}: ${types.join(', ')}.`,
  ];
  if (empty.length > 0) {
    lines.push(
      `⛔ ${empty.length} of those ${types.length} have NO nodes in this graph at all `
        + `(${empty.join(', ')}) — a symbol of those kinds cannot be found by this verb here, `
        + 'whether or not it exists in the source. Read the file, or use graph_search, before '
        + 'concluding it is absent.',
    );
  }
  return lines.join('\n');
}
