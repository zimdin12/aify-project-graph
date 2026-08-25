// What can this graph's answers ACTUALLY support? Reported separately from `trust`, because one
// word cannot carry two independent facts.
//
// ⛔ THE DEFECT THIS EXISTS FOR, MEASURED ON THIRD-PARTY REPOSITORIES:
//
//     fast-route (PHP)  0 compiler-verified edges  ->  trust: "strong"
//     fmt (C++)         0 compiler-verified edges  ->  trust: "ok"
//     click (Python)    1,410 verified (10.4%)     ->  trust: "weak"
//
// `computeTrustLevel` is a function of UNRESOLVED EDGE COUNT alone. It measures how completely
// extraction resolved its own references — a real and useful property — and says nothing about
// whether any edge was checked by a compiler. So the repository with NO verified edges reports the
// strongest trust, and the one that actually has a spine reports the weakest.
//
// ⚠ PHP CANNOT EVER SCORE DIFFERENTLY. There is no PHP language server here, so a PHP graph can
// never earn a verified edge — and it will keep reporting "strong" forever.
//
// ⇒ `graph_health` already warns about a missing spine in `nextActions`. The problem is that the
// HEADLINE CONTRADICTS THE WARNING, and a reader who believes the headline never reaches the
// correction. This project's own finding is that behaviour changes when a field CONTRADICTS an
// agent's confidence — here the contradiction points the wrong way.
//
// Review's ruling, followed exactly: report capabilities separately, do NOT refuse to call the
// graph usable, and do NOT auto-run a 60-second collection.

/**
 * @param {object} args
 * @param {number} args.compilerVerifiedEdges  edges carrying LSP_VERIFIED provenance
 * @param {boolean} args.indexed               is there a graph at all
 * @param {object|null} args.coverage          the collection's own coverage record, if any
 * @param {boolean} args.collectionAvailable   has a collection ever been imported
 * @param {string|null} args.language          primary language, when known
 * @param {boolean} args.languageHasServer     does a language server exist for it
 */
export function graphCapabilities({
  compilerVerifiedEdges = 0,
  indexed = false,
  coverage = null,
  collectionAvailable = false,
  language = null,
  languageHasServer = true,
} = {}) {
  // Orientation — "where does this live, what is near it, what does this module contain" — is
  // served by structural extraction and does not need a compiler. It is genuinely usable here.
  const orientationUsable = indexed === true;

  // ⛔ ABSENCE AUTHORITY FAILS CLOSED, AND ON EVERY CLAUSE. "No callers" is the claim that deletes
  // code. It requires verified edges AND a collection that covered the repo — a partial collection
  // makes an empty caller set a floor, not a fact.
  const hasVerified = Number.isInteger(compilerVerifiedEdges) && compilerVerifiedEdges > 0;
  const coverageComplete = coverage?.complete === true;
  const absenceAuthority = Boolean(indexed && collectionAvailable && hasVerified && coverageComplete);

  let reason = null;
  if (!indexed) reason = 'not_indexed';
  else if (!languageHasServer) reason = 'no_language_server';
  else if (!collectionAvailable) reason = 'no_collection';
  else if (!hasVerified) reason = 'trust_spine_empty';
  else if (!coverageComplete) reason = 'collection_partial';

  return {
    orientationUsable,
    compilerVerifiedEdges: Number.isInteger(compilerVerifiedEdges) ? compilerVerifiedEdges : 0,
    absenceAuthority,
    reason,
    // ⚠ NAMED so a reader is never left to infer what to do from a boolean. `null` only when the
    // capability is already satisfied — never as a shrug.
    nextAction: absenceAuthority ? null : nextActionFor(reason, language, languageHasServer),
    // Stated inline because the distinction is the entire point of this object.
    note: 'orientationUsable and absenceAuthority are independent. `trust` measures how completely '
      + 'extraction resolved its own references; it does NOT mean any edge was compiler-checked.',
  };
}

function nextActionFor(reason, language, languageHasServer) {
  switch (reason) {
    case 'not_indexed':
      return 'graph_index() to build the graph';
    case 'no_language_server':
      // ⛔ HONEST DEAD END. Telling a PHP user to run a collection would send them to a command
      // that cannot help, and a remedy that cannot work is worse than naming the limit.
      return `no language server for ${language ?? 'this language'} — caller sets here are `
        + 'heuristic permanently; verify with rg before any delete or rename';
    case 'no_collection':
    case 'trust_spine_empty':
      return 'graph_collect_code_intel({ scope: "all" }) to build the trust spine '
        + '(live code_intel_* verbs are unaffected and need no collection)';
    case 'collection_partial':
      return 'graph_collect_code_intel({ scope: "all" }) to finish coverage; per symbol, read '
        + 'evidence.exhaustive on code_intel_references rather than inferring from this summary';
    default:
      return languageHasServer ? 'graph_collect_code_intel({ scope: "all" })' : null;
  }
}
