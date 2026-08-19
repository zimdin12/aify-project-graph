// A DEAD END SHOULD CARRY ITS OWN NEXT STEP.
//
// Every symbol verb answered a miss with: `NO MATCH for "X". Try
// graph_search(query="X") to find similar names.` That is an instruction to make a
// SECOND call to get information this call already had in hand — the graph is open,
// the labels are indexed, and a near-miss is one query away.
//
// For an agent that is a wasted round-trip on every typo, every half-remembered
// name, and every `foo` that is actually `fooImpl`. Correctness work has dominated
// this codebase; friction is what actually decides whether a tool gets reached for,
// and "run another verb" is friction we were choosing to emit.
//
// Cheap by construction: one indexed LIKE over labels, capped, ranked in JS. If it
// finds nothing, the message degrades to exactly what it said before — so this can
// only add information, never remove it.

// Ranking is deliberately simple and explainable rather than a similarity score
// nobody can reason about: exact-case-insensitive, then prefix, then substring,
// then a leaf match (`Foo::bar` when you asked for `bar`), then edit-distance for
// genuine typos. An agent reading the output should be able to see WHY something
// was suggested.
const MAX_SUGGESTIONS = 5;
const CANDIDATE_CAP = 200;

// DAMERAU-Levenshtein: a TRANSPOSITION costs 1, not 2.
//
// Plain Levenshtein charges a swapped pair as two substitutions, and transposition
// is the single most common human typo. Measured consequence (ef-manager,
// 2026-07-31): `ISimDomian` for `ISimDomain` — one swapped pair — scored distance 2
// against a length-derived budget of 1, so the suggester found NOTHING and the miss
// path looked byte-identical to the unfixed version. The feature was present and
// silently useless on the most common typo it exists to catch.
//
// Early bail retained: we only care whether the distance is SMALL. Past the budget
// it is a different word, and offering it would be noise — and noise here costs the
// good suggestions their credibility.
export function editDistanceWithin(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  // Three rows: prev2 enables the transposition check (a[i-2..i-1] vs b[j-2..j-1]).
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

// ⛔ THE LEAF OF A FILE PATH WAS ITS EXTENSION, AND THE SUGGESTION SAID "same leaf name".
//
// Splitting on "::", "." and "->" is right for qualified SYMBOL names — the leaf of `Foo::bar`
// is `bar`, which is what this was written for. Applied to a path it takes the last dot
// segment, so the leaf of `engine/rendering/GpuMaterialPalette.h` is `h` and EVERY .h file in
// the repo "shares a leaf name" with it. ef-manager hit exactly that in the field: three
// unrelated headers suggested, each labelled with a basis that was not the basis.
//
// ★ Suggesting neighbours is fine; labelling the reason wrongly is not, because "same leaf
// name" claims the tool found your identifier somewhere else, which is strong enough to act on.
// Same defect as every other printed basis that did not match its computation this month — it
// happened to be printing a reason rather than a number.
//
// ⇒ A path's leaf is its BASENAME. A bare filename is its own leaf. Only qualified-name
// separators split, and a lone extension never becomes the thing being matched on.
function leafOf(name) {
  const s = String(name || '');
  // Path-shaped: the leaf is the basename, extension included.
  if (/[\\/]/.test(s)) return s.split(/[\\/]/).pop();
  // Filename-shaped (single dot, short extension): the whole name is the leaf.
  if (/^[^.]+\.[a-z0-9]{1,4}$/i.test(s)) return s;
  return s.split(/::|\.|->/).pop();
}

// ⛔ `lower === q` MATCHED THE EXACT NAME AND THE CASE VARIANT WITH ONE BRANCH, and printed
// the case-variant wording for both. Observed on this repo: `CODE_INTEL_SCHEMA_VERSION` came
// back labelled "same name, different case" against a byte-identical label. Same class as the
// `leafOf` defect above — a printed basis that is not the basis — and a stated reason is strong
// enough to act on, so a wrong one is worse than none at all.
export function rankSuggestions(query, rows) {
  const qRaw = String(query || '');
  const q = qRaw.toLowerCase();
  const qLeaf = leafOf(q);
  // Typo budget scales with length: a 4-char name allows 1 edit, a 20-char name 3.
  // A fixed budget either misses real typos in long names or suggests nonsense for
  // short ones.
  const budget = Math.max(1, Math.min(3, Math.floor(q.length / 6)));

  const scored = [];
  for (const r of rows) {
    const label = String(r.label || '');
    const lower = label.toLowerCase();
    const leaf = leafOf(lower);
    let rank = null;
    let why = '';
    if (label === qRaw) {
      rank = 0;
      // An External row with the exact name is not a spelling hint — it is the ANSWER to
      // "does this exist": the name is referenced in this repo and no declaration was ever
      // bound to it. Saying so is worth more than the suggestion it was pretending to be.
      why = r.type === 'External'
        ? 'exact name — referenced here, no declaration indexed'
        : 'exact name — present, but not matched by this verb';
    }
    else if (lower === q) { rank = 0; why = 'same name, different case'; }
    else if (leaf === qLeaf) { rank = 1; why = 'same leaf name'; }
    else if (lower.startsWith(q)) { rank = 2; why = 'starts with your query'; }
    else if (lower.includes(q)) { rank = 3; why = 'contains your query'; }
    else {
      const d = editDistanceWithin(leaf, qLeaf, budget);
      if (d <= budget) { rank = 4 + d; why = `${d} character${d === 1 ? '' : 's'} different`; }
    }
    if (rank !== null) scored.push({ ...r, _rank: rank, _why: why });
  }
  scored.sort((a, b) => a._rank - b._rank || String(a.label).localeCompare(String(b.label)));
  return scored.slice(0, MAX_SUGGESTIONS);
}

// Returns [] on any failure — a suggestion is a convenience and must never turn a
// clean "not found" into an error.
export function findSimilarSymbols(db, query) {
  if (!db || !query) return [];
  try {
    const q = String(query);
    const leaf = leafOf(q);
    const rows = db.all(
      `SELECT label, type, file_path, start_line FROM nodes
        WHERE type NOT IN ('Directory','Document','Config')
          AND (label LIKE $like OR label LIKE $leafLike)
        LIMIT ${CANDIDATE_CAP}`,
      { like: `%${q}%`, leafLike: `%${leaf}%` },
    );
    // The LIKE net misses pure typos (`cylindricalLatBads`), so widen once with a
    // prefix of the leaf when it found nothing worth ranking.
    let pool = rows;
    if (pool.length === 0 && leaf.length >= 4) {
      pool = db.all(
        `SELECT label, type, file_path, start_line FROM nodes
          WHERE type NOT IN ('Directory','Document','Config') AND label LIKE $pre
          LIMIT ${CANDIDATE_CAP}`,
        { pre: `${leaf.slice(0, Math.ceil(leaf.length / 2))}%` },
      );
    }
    return rankSuggestions(q, pool);
  } catch {
    return [];
  }
}

// Render the miss WITH its suggestions. Falls back to the original wording when
// nothing similar exists, so the message never gets worse.
// ⚠ `nextInstruction` lets the CALLER replace the trailing advice, because only the caller
// knows whether the fallback verb can help. ef-manager followed this message's top line on a
// miss that had already been diagnosed as "this declaration type has zero nodes" — and
// graph_search reads the same node table, so it returned nothing and could not have done
// otherwise. The message contained its own correction four lines down; the TOP line is the one
// that gets followed.
export function noMatchMessage(db, symbol, { verb = 'graph_search', nextInstruction } = {}) {
  const wider = nextInstruction || `${verb}(query="${symbol}") for a wider search.`;
  const suggestions = findSimilarSymbols(db, symbol);
  if (suggestions.length === 0) {
    return `NO MATCH for "${symbol}". ${nextInstruction
      || `Try ${verb}(query="${symbol}") to find similar names.`}`;
  }
  const lines = suggestions.map((s) => {
    const loc = s.file_path ? ` — ${s.file_path}${s.start_line ? `:${s.start_line}` : ''}` : '';
    return `  ${s.label} (${String(s.type || '?').toLowerCase()})${loc}  [${s._why}]`;
  });
  // ⛔ "RE-RUN WITH ONE OF THESE" OFFERED BACK THE STRING THE CALLER JUST PASSED, so the only
  // action on offer reproduced this identical output forever. It happened whenever the sole
  // candidate was an exact-name node the calling verb cannot return — an External stub, say,
  // against a verb that matches declaration types.
  //
  // ★ Do not drop the row: it carries real information. Change what is CLAIMED about it. The
  // remedy must be an action that can change the answer, which re-running is not.
  const alternatives = suggestions.filter((s) => String(s.label) !== String(symbol));
  if (alternatives.length === 0) {
    return [
      `NO MATCH for "${symbol}" — but a node with this exact name IS in this graph, and this `
        + 'verb did not match it:',
      ...lines,
      `Re-running with the same name returns this same answer. Read the site above, or ${wider}`,
    ].join('\n');
  }
  return [
    `NO MATCH for "${symbol}". Did you mean:`,
    ...lines,
    `Re-run with one of these, or ${wider}`,
  ].join('\n');
}
