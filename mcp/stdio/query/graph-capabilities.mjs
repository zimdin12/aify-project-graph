import { ATTESTATION } from '../storage/publication-schema.js';
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
 * @param {boolean|null} args.collectionCurrent  is the collection's commit still HEAD (null = unknown)
 * @param {number|null} args.collectionFilesCovered  files the collection covered (null = unknown)
 * @param {number|null} args.collectionFilesChanged  how many of those have changed since
 * @param {string|null} args.language          primary language, when known
 * @param {boolean} args.languageHasServer     does a language server exist for it
 */
export function graphCapabilities({
  compilerVerifiedEdges = 0,
  indexed = false,
  coverage = null,
  collectionAvailable = false,
  collectionCurrent = null,
  collectionFilesCovered = null,
  collectionFilesChanged = null,
  language = null,
  languageHasServer = true,
  integrity = null,
  attestation = null,
} = {}) {
  // ⛔ AN INTERRUPTED INDEX LEAVES A GRAPH THAT PASSES EVERY OTHER CHECK. Observed: a `graph_index`
  // killed mid-write left click holding 90 nodes — Document 43, Directory 25, Config 22 — and ZERO
  // code nodes, while the file existed, opened cleanly, carried a plausible count, and health
  // reported it as indexed.
  //
  // `writeManifest` writes to a temp file and renames atomically, so the manifest is replaced only
  // at the END of a successful run: an interrupted one leaves the DATABASE mangled while the
  // MANIFEST still describes the previous good state. The two disagree and nothing compared them —
  // every available check reads one side or the other, which is several checks sharing one blind
  // spot, i.e. one check.
  //
  // ⚠ A HALF-WRITTEN GRAPH CANNOT SUPPORT ORIENTATION EITHER, so this is not merely an absence
  // concern. And it is one more VALUE in `reason`, a field a reader already consults, rather than a
  // second place to look.
  const incomplete = isIndexIncomplete(integrity);

  // Orientation — "where does this live, what is near it, what does this module contain" — is
  // served by structural extraction and does not need a compiler. It is genuinely usable here,
  // UNLESS the graph itself is half-written.
  const orientationUsable = indexed === true && !incomplete;

  // ⛔ ABSENCE AUTHORITY FAILS CLOSED, AND ON EVERY CLAUSE. "No callers" is the claim that deletes
  // code. It requires verified edges AND a collection that covered the repo — a partial collection
  // makes an empty caller set a floor, not a fact.
  const hasVerified = Number.isInteger(compilerVerifiedEdges) && compilerVerifiedEdges > 0;
  const coverageComplete = coverage?.complete === true;
  // ⛔ A COMPLETE COLLECTION IS NOT A CURRENT ONE, and `coverage.complete` describes the collection
  // AT COLLECTION TIME — a frozen fact about a moving corpus. After the collection's commit, every
  // file that changed loses its verified evidence on the next rebuild (the per-file salvage gate
  // drops it rather than re-stamp shifted line numbers), so the spine erodes while `complete` still
  // reads true. Measured on this repository: 121 commits past its collection, one reindex took the
  // spine from 1,943 verified edges to 1,054 — and absenceAuthority was still being granted.
  //
  // `lsp-evidence` already calls this correctly per evidence block: with HEAD moved it renders "the
  // set is a FLOOR, not exhaustive". This flag disagreed with it, and of the two surfaces this is the
  // one a reader consults before deleting code.
  //
  // Unknown fails closed, like every other clause here: null is not evidence of currency.
  const collectionIsCurrent = collectionCurrent === true;

  // ⛔ AN UNATTESTED GRAPH CANNOT SUPPORT AN ABSENCE CLAIM, WHATEVER ELSE IS TRUE OF IT.
  // Every clause below this one asks how good the evidence is. This one asks whether the graph in
  // front of us is the graph the manifest is describing — and if that cannot be established, the
  // quality of the evidence is a question about something else.
  //
  // ⚠ NOT SUPPLIED IS ITS OWN STATE, AND IT DENIES. A caller that forgets to pass the attestation
  // gets `attestation_unknown`, not a pass: the alternative is a gate that silently opens for every
  // caller written before it existed, which is the fail-open default this project keeps removing.
  const attested = attestation === ATTESTATION.ATTESTED;

  const absenceAuthority = Boolean(
    indexed && !incomplete && attested
    && collectionAvailable && hasVerified && coverageComplete && collectionIsCurrent,
  );

  let reason = null;
  if (!indexed) reason = 'not_indexed';
  else if (incomplete) reason = 'index_incomplete';
  // ⚠ ORDERED AFTER index_incomplete DELIBERATELY. A half-written graph is the more specific and
  // more actionable diagnosis, and health.js already probes this function for exactly that reason
  // with no attestation to hand.
  else if (attestation === ATTESTATION.LEGACY_UNATTESTED) reason = 'legacy_unattested';
  else if (attestation === ATTESTATION.NEVER_COMPLETED) reason = 'never_completed';
  else if (attestation === ATTESTATION.GENERATION_MISMATCH) reason = 'generation_mismatch';
  else if (attestation === ATTESTATION.MANIFEST_UNUSABLE) reason = 'manifest_unusable';
  else if (!languageHasServer) reason = 'no_language_server';
  else if (!collectionAvailable) reason = 'no_collection';
  else if (!hasVerified) reason = 'trust_spine_empty';
  else if (!coverageComplete) reason = 'collection_partial';
  // ⛔ KNOWN-STALE AND UNKNOWN-CURRENCY ARE DIFFERENT FACTS AND GET DIFFERENT REASONS.
  // Both deny authority — unknown fails closed — but only one of them knows why. Collapsing them
  // made the refusal assert "taken at an older commit" in the state where no comparison was
  // possible at all, and prescribe a re-collect that cannot help: in a non-git checkout HEAD is
  // unreadable no matter how many collections are run. WorktreeState already models this with
  // `headKnown`, and non-git checkouts are supported.
  else if (collectionCurrent === false) reason = 'collection_stale';
  else if (collectionCurrent !== true) reason = 'collection_currency_unknown';
  // ⛔ LAST, BECAUSE IT IS A FACT ABOUT THE CALLER AND NOT ABOUT THE GRAPH. It still DENIES — an
  // authority nobody asked to verify is not granted — but it must not outrank a real diagnosis.
  // Placed first, it masked `no_collection` and `trust_spine_empty` on every caller written before
  // it existed, and an existing test named "does not mask a more severe reason that was already
  // firing" caught it immediately. A caller bug reported in place of a graph state sends the next
  // reader to rebuild a healthy index.
  else if (!attested) reason = 'attestation_unknown';

  return {
    orientationUsable,
    // Reported, not merely consumed: a reader who is denied authority must be able to see WHICH
    // of the four states denied it without re-deriving the comparison themselves.
    attestation,
    compilerVerifiedEdges: Number.isInteger(compilerVerifiedEdges) ? compilerVerifiedEdges : 0,
    absenceAuthority,
    reason,
    // ⚠ NAMED so a reader is never left to infer what to do from a boolean. `null` only when the
    // capability is already satisfied — never as a shrug.
    nextAction: absenceAuthority
      ? null
      : nextActionFor(reason, language, languageHasServer, integrity,
        { collectionFilesCovered, collectionFilesChanged }),
    // Stated inline because the distinction is the entire point of this object.
    note: 'orientationUsable and absenceAuthority are independent. `trust` measures how completely '
      + 'extraction resolved its own references; it does NOT mean any edge was compiler-checked.',
  };
}

// ⛔ A BINARY STALENESS FLAG ON AN ACTIVE REPOSITORY IS ALWAYS ON, AND AN ALWAYS-ON WARNING IS
// IGNORED. `collection_stale` fires after a single commit — correct, because that file's evidence is
// genuinely gone — but "stale" reads the same whether one covered file changed or fifty. The verdict
// stays binary because the authority question is binary; the MAGNITUDE goes in the message, so a
// reader can tell a nudge from an emergency. One more value in a field they already read.
function nextActionFor(reason, language, languageHasServer, integrity = null, decay = {}) {
  switch (reason) {
    case 'not_indexed':
      return 'graph_index() to build the graph';
    case 'index_incomplete':
      // ⚠ NAMES THE DISAGREEMENT, ASSERTS NO CAUSE. An interrupted index and a hand-edited database
      // are indistinguishable from here, so this reports the two numbers and stops.
      return 'graph_index({ force: true }) — this graph is partial: the manifest describes '
        + `${integrity?.manifestNodes ?? '?'} nodes and the database holds `
        + `${integrity?.dbNodes ?? '?'}. Treat every answer from it as a floor, including orientation.`;
    // ⚠ THREE STATES, THREE REMEDIES. They all deny authority, and telling a reader the wrong one
    // sends them to a command that cannot help — which is worse than saying nothing, because they
    // will believe it worked.
    case 'legacy_unattested':
      return 'graph_index() — this graph was built before publication was attested, so there is no '
        + 'way to check that its contents match what the manifest claims. Orientation is unaffected; '
        + 'absence claims ("no callers") are a FLOOR until one rebuild publishes a generation.';
    case 'never_completed':
      // NOT the same as legacy, and deliberately not worded like it: the table exists, so the
      // question WAS asked, and the answer is that nothing has ever been published into it.
      return 'graph_index() — the graph carries a publication record that has never been completed '
        + '(generation 0). This is an empty graph presenting as a real one; treat every answer, '
        + 'orientation included, as describing nothing.';
    case 'generation_mismatch':
      // The crash window: the database committed and the manifest write did not follow.
      return 'graph_index() — the database and the manifest name DIFFERENT generations, so a '
        + 'rebuild committed and its manifest never landed. The graph itself is whole and '
        + 'orientation is safe; it is unattested, which is recoverable by re-running the index.';
    case 'manifest_unusable':
      // ⛔ THE COMPARISON DID NOT HAPPEN. Reported as generation_mismatch until it was reproduced on
      // a copy of the real graph, which meant telling a reader a rebuild had committed without its
      // manifest — a crash window nothing established. The remedy is the same command; the claim is
      // not, and the claim is what a reader acts on.
      return 'graph_index() — the graph manifest could not be read (missing or corrupt), so its '
        + 'generation could not be compared against the database. This says nothing about whether '
        + 'the graph itself is torn: the comparison did not happen. Orientation is unaffected; '
        + 'absence claims are a FLOOR until a rebuild writes a manifest that can be read.';
    case 'attestation_unknown':
      // ⛔ A CALLER-SIDE FAULT, SAID AS ONE. Reporting this as legacy would blame the graph for a
      // caller that never asked the question, and the next person would rebuild a healthy index.
      return 'the caller did not supply an attestation, so authority is denied without any claim '
        + 'about this graph. This is a bug in the calling verb, not a state of the index.';
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
    case 'collection_currency_unknown':
      // ⚠ NAMES THE TWO CANDIDATES AND ASSERTS NEITHER. One is fixable by re-collecting, the other
      // is not fixable at all, so promising a single remedy would be wrong half the time.
      return 'the currency of the collection could not be established — either it predates commit '
        + 'tracking (re-collect fixes that) or HEAD is unreadable here, as in a non-git checkout '
        + '(re-collecting cannot fix that). Caller sets are a FLOOR either way; verify with rg '
        + 'before any delete or rename';
    case 'collection_stale':
      // Names what decayed and why, because "re-collect" without a cause reads as ceremony.
      return 'graph_collect_code_intel({ scope: "all" }) — the collection is complete but was taken '
        + 'at an older commit, so every file changed since then has lost its verified evidence'
        + (Number.isInteger(decay.collectionFilesChanged) && Number.isInteger(decay.collectionFilesCovered)
          ? ` (${decay.collectionFilesChanged} of ${decay.collectionFilesCovered} covered files have changed)`
          : '')
        + '. Caller sets are a FLOOR until it is retaken; verify with rg before any delete or rename';
    default:
      return languageHasServer ? 'graph_collect_code_intel({ scope: "all" })' : null;
  }
}

/**
 * Did an index fail to finish writing this graph?
 *
 * TWO SIGNALS, AND THE PAIR IS REQUIRED — either alone is ambiguous:
 *   · the manifest's counts disagree with what the database holds. The manifest is renamed
 *     atomically at the END of a successful index, so a disagreement means the run did not finish.
 *   · zero code nodes in an otherwise non-empty graph — the exact shape observed.
 *
 * ⚠ A DOCS-ONLY REPOSITORY LEGITIMATELY HAS NO CODE NODES and is not degraded. So the zero-code
 * signal never fires on its own: it requires the manifest to claim MORE than the database holds.
 *
 * ⚠ UNKNOWN REFUSES TO ACCUSE. Absent counts return false — a graph is not called broken because
 * its integrity could not be read. That direction is deliberate: the opposite would fail every
 * older graph whose manifest predates these fields.
 */
function isIndexIncomplete(integrity) {
  if (!integrity) return false;
  const { manifestNodes, dbNodes, manifestEdges, dbEdges, codeNodes } = integrity;
  const known = Number.isInteger(manifestNodes) && Number.isInteger(dbNodes);
  if (!known) return false;

  // The database holding FEWER than the manifest promised is the interrupted-write signature.
  // More is not: a collection legitimately adds nodes after the index that wrote the manifest.
  const shortOfManifest = dbNodes < manifestNodes
    || (Number.isInteger(manifestEdges) && Number.isInteger(dbEdges) && dbEdges < manifestEdges);
  if (!shortOfManifest) return false;

  // Short AND stripped of code is the observed failure. Short alone could be a pruned collection.
  return Number.isInteger(codeNodes) ? codeNodes === 0 : true;
}
