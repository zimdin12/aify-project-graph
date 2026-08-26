// THE ONE HOOK CONTENT THAT SURVIVED ITS FIRE-RATE MEASUREMENT.
//
// Roadmap 3b's exit criterion is a number: "fire on more than a small fraction of edits and it is
// slop by definition, however clever." Two candidates were measured against 120 real commits, 83
// of which touched a source file — the population a PostToolUse hook would see:
//
//     A  "here are the callers of what you just edited"   71/83 = 85.5%, mean 15 files   DEAD
//     B  "you deleted something that still has callers"    4/83 =  4.8% (upper bound)    THIS
//
// ⇒ Rule A is not a tuning problem. "X has callers" is true of almost every edit in a connected
// codebase, so it cannot be a CONTRADICTION — and the measured finding this whole phase rests on is
// that behaviour changes only when a field contradicts the agent's confidence, never when it adds
// data. A frequent signal later disproved teaches an agent to ignore it permanently.
//
// ⇒ Rule B is what a contradiction looks like: you removed something, and something still needs it.
//
// ⛔ THE STALENESS IS THE MECHANISM, NOT A BUG. This reads the graph as it was BEFORE the edit —
// the index has not been rebuilt yet, so it still holds the symbol you just deleted and everything
// that called it. That pre-edit knowledge is precisely what can tell you what you have broken. A
// freshly rebuilt graph could not: the symbol would simply be gone.
//
// ⚠ AND IT IS DELIBERATELY NOT A DEAD-CODE CHECK. `safe-to-delete` exists for the question "is
// anything using this", is careful about what it cannot certify, and is invoked when the user is
// ASKING. This fires unbidden, so it must only speak when the answer contradicts what the editor
// evidently believed. Silence here is the default and the common case.

// A declaration whose removal is worth checking. Kept narrow on purpose: a local `let` inside a
// function body is noise, an exported name is a contract.
//
// ⚠ ANCHORED TO THE DIFF MARKER so a `-` line is required. Matching declaration text anywhere in a
// diff would fire on every ADDED declaration too, which is the opposite of the intent.
const REMOVED_DECL = /^-\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const ADDED_DECL = /^\+\s*(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;

/**
 * Names a unified diff removes and does not put back.
 *
 * ⛔ THE `readded` SET IS THE WHOLE CORRECTNESS OF THIS. A MODIFIED declaration is a `-`/`+` pair on
 * the same name — changing `const EXTRACTOR_VERSION = '0.3.0'` to `'0.4.0'` deletes nothing. The
 * first version of the fire-rate measurement missed that and reported 15.7% instead of 4.8%, which
 * reads as "too noisy to ship" and would have killed this rule before it was written.
 *
 * @param {string} diff  unified diff text
 * @returns {{ name: string, exported: boolean }[]}
 */
export function removedDeclarations(diff) {
  const lines = String(diff ?? '').split(/\r?\n/);
  const readded = new Set();
  for (const line of lines) {
    const m = ADDED_DECL.exec(line);
    if (m) readded.add(m[1]);
  }
  const out = new Map();
  for (const line of lines) {
    const m = REMOVED_DECL.exec(line);
    if (!m || readded.has(m[1])) continue;
    // An exported removal seen anywhere wins: the same name may appear on several removed lines.
    const exported = /^-\s*export\s/.test(line) || out.get(m[1])?.exported === true;
    out.set(m[1], { name: m[1], exported });
  }
  return [...out.values()];
}

/**
 * Callers of the symbol DECLARED IN A SPECIFIC FILE, from the graph's pre-edit state.
 *
 * ⛔⛔ THIS RESOLVED BY BARE LABEL IN ITS FIRST VERSION, AND THAT IS THE DEFECT THIS REPOSITORY
 * DELETED A WHOLE RULE FOR THIS WEEK. Run against the real graph, it picked `has` — a Map/Set
 * method name — and announced "193 callers of it outside the files you edited". Every `x.has(y)`
 * anywhere in the corpus counted, because `dst.label = $name` cannot tell one `has` from another.
 *
 * ⇒ doc_ref rule 3 was deleted at 0.9311 for exactly this: EXISTENCE AND UNIQUENESS IN THE INDEX
 * ARE NOT EVIDENCE OF REFERENCE. I rebuilt it in a hook the same day, and would have shipped a
 * signal whose whole purpose is to be believed.
 *
 * ⇒ Resolution is now by IDENTITY: the node declared in the file the declaration was removed from.
 * The diff supplies that file, so the qualifier is free — the same "adjacent evidence" property
 * that separated the doc→symbol rules which survived from the one that did not.
 *
 * ⚠ AND AMBIGUITY FAILS CLOSED, TO SILENCE. If no node matches, or several do, this returns nothing
 * rather than guessing. A hook that fires wrongly is worse than one that misses: it is unbidden, it
 * cannot be checked cheaply, and one confident false alarm is enough to get it muted for good.
 *
 * ⚠ SAME-FILE CALLERS ARE EXCLUDED, a judgement rather than an oversight. Someone deleting a helper
 * and its one local use in a single edit is doing what they meant to. A caller in ANOTHER file is
 * the contradiction.
 */
function callersOf(db, name, declaredIn, editedFiles) {
  if (!declaredIn) return null;
  // ⛔ THE TARGET MUST BE A DECLARATION, NOT ANY NODE THAT SHARES THE NAME.
  //
  // Found after code-intel collection raised verified edges from 19 to 3,008 — i.e. only once the
  // evidence was good enough for the rule to fire at all. It fired on `allowed`, reporting twelve
  // callers. `allowed` is a DESTRUCTURED PARAMETER of `expectAbsentWithLiveMatcher`, indexed as a
  // `Symbol` node, and its "callers" are files passing `{ forbidden, allowed }` — genuine LSP
  // references to a property name, carried under the CALLS relation. Nobody calls a parameter.
  //
  // ⇒ The diff said `export function X`. So the node this resolves to must be something that
  // could have been declared that way. Matching any same-named node in the file re-admits the
  // whole class of near-miss the file-scoping was introduced to close, one level down.
  //
  // ⚠ AND THE CASE THAT EXPOSED IT WAS BUILT ON A FALSE PREMISE — my probe synthesised
  // `-export function allowed()` for something that is not a function. A fabricated input found a
  // real defect, which is luck rather than method; the control below uses the true shape.
  const CALLABLE = "('Function','Method','Class','Interface','Type')";
  const targets = db.all(
    `SELECT id FROM nodes WHERE label = $name AND file_path = $file AND type IN ${CALLABLE}`,
    { name, file: declaredIn },
  );
  // Zero: the graph never knew this symbol as a declaration, so it can contradict nothing.
  // More than one: the name is not unique even within its own file, and picking is guessing.
  if (targets.length !== 1) return null;
  // ⛔⛔ VERIFIED EDGES ONLY, AND THIS IS WHY THE RULE IS INERT TODAY.
  //
  // Resolving the TARGET by identity was not enough, because the EDGES are resolved by label too.
  // Measured against the real graph after that fix: deleting `writeFile` — declared in a test file,
  // spelled like Node's fs function — reported SEVENTY callers. Deleting `has` reported 193. Every
  // `x.has(y)` in the corpus had been attributed to one `has` node by the extractor.
  //
  //     whole-graph CALLS/REFERENCES/IMPORTS provenance, WHEN THAT WAS WRITTEN:
  //         EXTRACTED     12024      tree-sitter heuristic, resolved by label
  //         AMBIGUOUS      1028
  //         LSP_VERIFIED     19      compiler-resolved
  //
  // ⚠ THAT 19 IS NO LONGER TRUE AND THE CORRECTION MATTERS, because 19 reads as "this rule is dead"
  // and would stop a reader from ever enabling it. Re-measured 2026-08-26 on this repository:
  //
  //         EXTRACTED     12433      LSP_VERIFIED   2379  (15.4%)      AMBIGUOUS   555
  //
  // ⚠ DATED, because the last figure here went stale and read as a verdict. This one was taken on
  // 2026-08-26 and the share moves with every reindex and every collection. Re-derive it with
  // `node scripts/measure-hook-fire-rate.mjs`, which reports it beside the fire rate for exactly
  // this reason, rather than quoting the number above.
  //
  // ⛔⛔ AND THE FIGURE DEPENDS ENTIRELY ON WHETHER A COLLECTION HAS RUN, not on the code. Measured
  // by executing it: a FRESHLY INDEXED graph of this same repository holds 12,837 EXTRACTED, 1,230
  // AMBIGUOUS and **ZERO** verified edges. `graph_index` alone can never make this rule speak;
  // `graph_collect_code_intel` is what changes the answer.
  //
  // ⇒ So "how often does this fire" is not a property of the hook. It is a property of the GRAPH it
  // is pointed at, and any statement of its value has to name which graph.
  //
  // ⇒ A hook is UNBIDDEN and cannot be cheaply checked, so it may only make claims its evidence
  // supports. "You removed X and it has 70 callers" built on heuristic label matches is the most
  // confident-sounding sentence in the product resting on its least reliable data — and one false
  // alarm gets a hook muted for good.
  //
  // ⚠ SO THIS FIRES ALMOST NEVER ON THIS GRAPH, AND THAT IS THE HONEST STATE rather than a bug to
  // tune around. It becomes useful exactly as code-intel collection coverage grows, and not before.
  // The alternative — shipping it on EXTRACTED edges — is the defect this repository deleted a doc
  // rule for this same week: existence in the index is not evidence of reference.
  const rows = db.all(
    `SELECT DISTINCT src.file_path AS file, src.label AS caller
       FROM edges e
       JOIN nodes src ON src.id = e.from_id
      WHERE e.to_id = $id
        AND src.file_path != ''
        AND e.relation IN ('CALLS','REFERENCES','IMPORTS')
        AND e.provenance = 'LSP_VERIFIED'`,
    { id: targets[0].id },
  );
  const edited = new Set(editedFiles ?? []);
  return rows.filter((r) => !edited.has(r.file));
}

/**
 * Which file each `-` line belongs to, from the diff's own `+++ b/<path>` headers.
 *
 * The file is what makes the resolution above unambiguous, and the diff already carries it — so
 * the qualifier costs nothing and no caller has to supply it.
 */
function fileForEachRemoval(diff) {
  const out = [];
  let current = null;
  for (const line of String(diff ?? '').split(/\r?\n/)) {
    const header = /^\+\+\+ b\/(.+)$/.exec(line);
    if (header) { current = header[1].trim(); continue; }
    if (/^--- /.test(line)) continue;
    const m = REMOVED_DECL.exec(line);
    if (m) out.push({ name: m[1], exported: /^-\s*export\s/.test(line), file: current });
  }
  return out;
}

/**
 * The finding, or an empty list. This is the whole content of hook rule B.
 *
 * @param {object}   args
 * @param {object}   args.db          an open graph database
 * @param {string}   args.diff        unified diff of the edit
 * @param {string[]} args.editedFiles files this edit touched
 * @param {boolean}  [args.exportedOnly=true]
 * @returns {{ symbol: string, callers: {file:string,caller:string}[], message: string }[]}
 */
export function deletedWithCallers({ db, diff, editedFiles = [], exportedOnly = true }) {
  // `removedDeclarations` decides WHAT was genuinely removed; this decides WHERE from, which is
  // what makes the lookup an identity rather than a name match.
  const genuinelyRemoved = new Set(removedDeclarations(diff).map((d) => d.name));
  const findings = [];
  const seen = new Set();
  for (const d of fileForEachRemoval(diff)) {
    if (!genuinelyRemoved.has(d.name)) continue;      // modified, not deleted
    if (exportedOnly && !d.exported) continue;
    const key = `${d.file}::${d.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // null = could not resolve to exactly one declaration; silence, not a guess.
    const callers = callersOf(db, d.name, d.file, editedFiles);
    if (!callers || callers.length === 0) continue;
    findings.push({ symbol: d.name, callers, message: contradictionMessage(d.name, callers) });
  }
  return findings;
}

/**
 * ⛔ THE MESSAGE STATES THE CONTRADICTION AND NOTHING ELSE.
 *
 * No caller list "for your information", no suggestion to run another verb, no restatement of what
 * the editor just did. Every extra clause is a reason to skim it next time, and this rule's entire
 * value is that it is rare enough to still be read.
 *
 * ⚠ It says "the graph's last index" out loud, because the claim is only as good as that snapshot —
 * a caller added since the last index is invisible here, and a caller deleted since may be stale.
 * The reader needs to know which surface the contradiction came from.
 */
function contradictionMessage(symbol, callers) {
  const shown = callers.slice(0, 3).map((c) => `${c.file}${c.caller ? ` (${c.caller})` : ''}`);
  const more = callers.length > shown.length ? `, +${callers.length - shown.length} more` : '';
  return `You removed \`${symbol}\`, but the graph's last index has ${callers.length} caller`
    + `${callers.length === 1 ? '' : 's'} of it outside the files you edited: ${shown.join('; ')}${more}.`;
}
