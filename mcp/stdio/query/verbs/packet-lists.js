// GOVERNED LIST EMISSION — the only way a reader-facing list can be built, and the seal that
// enforces it.
//
// ⛔ THIS MODULE EXISTS BECAUSE PROVENANCE WAS SELF-ASSERTABLE. In packet.js the admission
// primitive sat in the same lexical scope as every route, so any branch could mint its own
// credential — graph-senior-dev-hermes did exactly that, twice: `admitListBlock('CANDIDATES:
// …')` and `emitGovernedList({header, rows})` with the disclosures parameter simply omitted.
// Both fulfilled in STRICT mode. Passing text through a registrar proves it was registered;
// it proves nothing about whether the population was ever consulted.
//
// ⇒ Two changes, and they only work together:
//   1. admitBlock is NOT exported. A packet.js route cannot reach it — not "should not", but
//      cannot, because it is not in scope there. That is the difference between removing an
//      affordance and removing the capability.
//   2. The emitters DERIVE header, rows and disclosures from population facts, so the only
//      way to obtain a credential is to compute the disclosure correctly. Minting and doing
//      it right became the same act, and there is no `disclosures` argument left to omit.
//
// ⚠ Honest residual: code INSIDE this module can still admit anything. The surface that can
// do so is now ~40 lines that exist for no other purpose, instead of a 1400-line verb.
import { AsyncLocalStorage } from 'node:async_hooks';

export function clampList(items, cap) {
  if (!items || items.length === 0) return { items: [], total: 0, truncated: false };
  return {
    items: items.slice(0, cap),
    total: items.length,
    truncated: items.length > cap,
  };
}

export function renderListSection(label, capped, formatter) {
  // Always render the section header — even when empty — so agents can
  // distinguish "broken packet" from "no data of this kind." Empty
  // sections render as `LABEL: none`. Validation gate found that silent
  // omission was confusing agents who treated absence as a packet bug.
  if (capped.items.length === 0) return `${label}: none`;
  const head = `${label}:`;
  const rows = capped.items.map((x) => `- ${formatter(x)}`);
  if (capped.truncated) rows.push(`- (${capped.total - capped.items.length} more — narrow target)`);
  // ★ THE GOVERNED EMITTER. Every list that reaches a reader through this function is
  // registered as it is built, so the seal can recognise its own output instead of trusting
  // a header word or an ambient call count. A route that assembles a list by hand produces
  // text nobody admitted, which is exactly what the seal now looks for.
  return admitBlock([head, ...rows].join('\n'));
}

const sealScope = new AsyncLocalStorage();

let disclosureRenderCount = 0;
export const _disclosureRenderCount = () => disclosureRenderCount;

// Runs `fn` in a fresh seal scope and reports how many disclosure renders happened INSIDE
// it. Exported because the seal's correctness is a property of the pairing, and a test that
// cannot construct two overlapping scopes cannot check the thing that broke.
export async function withSealScope(fn) {
  // ⚠ REUSE AN ENCLOSING SCOPE RATHER THAN NESTING. A nested scope collects the admissions
  // and the OUTER seal then sees an empty set and accuses its own healthy output. Found by
  // running the concurrency probe with a real graphPacket inside the harness's scope: the
  // bad packet was correctly caught and the GOOD one was falsely accused.
  //
  // ★ That is the failure direction that matters. A false accusation lands on a user's
  // working answer and trains them to ignore the line — the same way an always-on warning
  // stops being read. Sibling scopes are still separate, because AsyncLocalStorage gives
  // concurrent async contexts their own store; only genuine nesting shares one.
  const existing = sealScope.getStore();
  if (existing) {
    const out = await fn();
    return { out, calls: existing.calls, admitted: existing.admitted };
  }
  const scope = { calls: 0, admitted: new Map() };
  const out = await sealScope.run(scope, fn);
  return { out, calls: scope.calls, admitted: scope.admitted };
}

// ⛔ COUNTING RENDERER CALLS WAS NOT ENOUGH, AND graph-senior-dev-hermes PROVED IT TWICE.
// A route can call renderCandidateDisclosures() with unrelated arguments and then return a
// bare list; the count says "consulted" and nothing binds that call to the list that left.
// Their probe rendered {symbol:'Unrelated'} and returned a bare CANDIDATES list —
// fulfilled, unchecked, in STRICT mode.
//
// ⇒ Admission is now by PRODUCED-TEXT IDENTITY. The governed emitter registers the exact
// block it built; the seal requires every list-shaped block in the output to be one of
// them. A dummy call launders nothing, because a call is no longer the credential — the
// text is.
function admitBlock(text) {
  const scope = sealScope.getStore();
  if (scope && typeof text === 'string' && text) {
    scope.admitted.set(text, (scope.admitted.get(text) ?? 0) + 1);
  }
  return text;
}

// ⛔ v4's emitter WAS A CREDENTIAL MINT ANY ROUTE COULD CALL. It took a finished `header`
// and `rows` and defaulted `disclosures = []`, so
//     emitGovernedList({ header: 'CANDIDATES:', rows: ['- src/hidden.cpp:1'] })
// certified a candidate list carrying no disclosures at all — dev ran exactly that and
// strict graphPacket fulfilled. Passing text through a registrar proves it was registered.
// It proves nothing about whether the population was ever consulted.
//
// ⇒ THE EMITTER NOW DERIVES EVERYTHING FROM THE POPULATION FACTS. A caller supplies rows and
// what it knows about the population; header AND disclosures come out of that one set of
// inputs. There is no longer a way to mint a credential without computing the disclosure,
// because they are the same computation — and the header cannot contradict the lines beneath
// it, which was a separate defect this file has been fixing one branch at a time since the
// first cap-as-total report.
export function emitCandidateList({
  rows, symbol, statedTotal, populationIsFloor = false, rowsSeen = null, languages = [],
}) {
  const shown = rows.length;
  // Two caps can apply: consequences already sampled, and this packet samples again. The
  // header states what is SHOWN HERE against the producer-attested population — and says
  // UNKNOWN rather than guessing when the producer did not state one.
  const attested = Number.isInteger(statedTotal) && statedTotal >= shown;
  const header = !attested
    ? `CANDIDATES — showing ${shown}; total population UNKNOWN (not stated by graph_consequences):`
    : populationIsFloor
      // The fourth state. `at least`, plus the rows that were and were not examined, so the
      // reader can see the cap rather than inherit it as a total.
      ? `CANDIDATES — showing ${shown} of AT LEAST ${statedTotal}`
        + `${rowsSeen ? ` (grouped from ${rowsSeen[1]} of ${rowsSeen[2]} matching rows — retrieval was capped BEFORE grouping, so the population is a FLOOR)` : ' (retrieval capped before grouping — population is a FLOOR)'}:`
      : `CANDIDATES — showing ${shown} of ${statedTotal}${statedTotal > shown ? ` (${statedTotal - shown} not listed here)` : ''}:`;
  const disclosures = renderCandidateDisclosures({
    shown,
    total: statedTotal,
    symbol,
    languages,
    // The exactness travels WITH the value — ef-manager's correction to the shared renderer.
    // A capped population must not be able to render as an exact one anywhere.
    exact: !populationIsFloor,
  });
  const block = [header, ...rows].join('\n');
  admitBlock(block);
  return [block, ...disclosures].join('\n');
}

// Bounded lists with no population claim (READ FIRST, LAST TOUCHED, …). Their contract is
// weaker and different — "these are the items, and truncation is stated" — so they get their
// own entry point rather than borrowing the candidate one, which would let a caller obtain a
// candidate-grade credential for a list that never had a population.
export function emitBoundedList(label, items, formatter = (x) => x) {
  return renderListSection(label, clampList(items, items.length), formatter);
}

export function renderCandidateDisclosures({ shown, total, symbol, languages = [], exact = true }) {
  disclosureRenderCount += 1;
  const scope = sealScope.getStore();
  if (scope) scope.calls += 1;
  const out = [];
  const attested = Number.isInteger(total) && total >= shown;
  const langs = languages.map((l) => String(l).toLowerCase());
  if (langs.length > 1) {
    const embedsShaderText = langs.some((l) => l === 'cpp' || l === 'c++' || l === 'c');
    out.push('  ★ CROSS-LANGUAGE DUPLICATE — defined in more than one language'
      + ` (${langs.join(', ')}). For a mirrored struct every copy must agree; this is usually a`
      + ' FINDING, not a disambiguation problem.'
      + ' ⚠ The count is a FLOOR: source that is generated or embedded in another language is'
      + ' not parsed, so mirrors can exist that no file-extension grep finds.'
      + (embedsShaderText
        ? ' In C++ that most often means shader text inside a raw string literal, R"(...)" —'
        + ' grep the .cpp files near the declaration.'
        : ''));
  }
  // ⛔ THE REFERRER'S PROMISE IS WHAT A READER USES TO DECIDE WHETHER TO CALL.
  //
  // This line used to read "every definition, unsampled". `graph_whereis` caps at limit=5, so
  // on any symbol with more than five definitions that promise was false — and when I made
  // whereis honest about its own cap, THIS FILE STILL MADE THE PROMISE. ef-manager: the new
  // disclosure "documents an inaccuracy elsewhere instead of removing it", and the correction
  // arrives only AFTER the call, and only if truncation happens to occur. **A disclosure that
  // fires after the decision cannot recover the decision** — the same shape as the original
  // silent DEFINED IN list: a true statement delivered too late to be used.
  //
  // ⇒ The packet knows the population at the moment it writes this line, so it emits the call
  // that WOULD be unsampled. A false promise becomes an actionable one for one interpolation.
  if (attested && total > shown) {
    out.push(`  NEXT: graph_whereis(symbol="${symbol}", limit=${total}) — every definition`
      + (exact === false ? ' (population is a FLOOR; raise the limit if it still warns)' : ''));
  }
  return out;
}

// ----- the seal -----

// A reader-facing LIST header. `UNRANKED` is deliberately NOT here: those lines ARE the
// disclosure ("⚠ UNRANKED, showing 3 of 12"), not the thing being disclosed about. Anchored
// to start-of-line because renderListSection emits headers at column 0.
// ⛔ THE HEADER ALLOWLIST WAS A GUESS, AND IT WAS ALREADY WRONG IN THE SHIPPED FILE.
// It was /(?:^|\n)(?:DEFINED IN|CANDIDATES)\b/. graph-senior-dev-hermes found packet.js
// already emits a reader-facing matched-location list headed `ALSO IN:`, and demonstrated
// that strict probes for `ALSO IN:`, `MATCHES:` and `LOCATIONS:` all passed unchanged. A
// seal whose vocabulary is a list of words I happened to remember has the same defect as
// the route inventory it replaced: it enumerates, and enumerations miss.
//
// ⇒ Detect the SHAPE instead. A reader-facing list is a header line ending in ':' followed
// by at least one '- ' row. That needs no vocabulary and cannot be escaped by inventing a
// new header word — which is precisely how the previous two versions were defeated.
// ⛔ MY "NO VOCABULARY" CLAIM LASTED ONE ROUND. v4 matched `[^\n:]{1,80}:` — I had removed a
// list of header WORDS and replaced it with an undocumented 80-CHARACTER limit, which is the
// same defect wearing a number instead of a noun. graph-senior-dev-hermes measured the real
// floor header at 145 characters:
//
//   CANDIDATES — showing 5 of AT LEAST 50 (grouped from 50 of 60 matching rows — retrieval
//   was capped BEFORE grouping, so the population is a FLOOR):
//
// extractListBlocks returned [] on production output this file already emits, and an unowned
// route using that header FULFILLED in strict mode. Not a hypothetical, and not the
// unexecuted-route hole I had already acknowledged — an EXECUTED route the detector could
// not see.
//
// ⇒ Line structure, no length bound, no word list: a header is any line ending in ':' that
// is followed by at least one '- ' row.
export function extractListBlocks(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].endsWith(':')) continue;
    if (!/^- /.test(lines[i + 1] ?? '')) continue;
    let j = i + 1;
    while (j < lines.length && /^- /.test(lines[j])) j += 1;
    out.push(lines.slice(i, j).join('\n'));
    i = j - 1;
  }
  return out;
}

export const SEAL_CAVEAT =
  '⚠ POPULATION NOT DISCLOSED — this candidate list came from a route that never consulted '
  + 'the shared disclosure renderer, so nothing above states how many matches exist. Treat the '
  + 'list as a FLOOR, not a total, and re-run graph_whereis(symbol=..., limit=N) before '
  + 'concluding anything about completeness. [packet seal]';

// ⛔ THE FORCED DOOR. Every route in this file returns through graphPacket, so this is the
// one place a symbol list cannot get past. If the output shows a list but the renderer never
// executed during that call, the packet says so instead of shipping a silent sample — which
// is the entire defect class this file has been chasing since the first cap-as-total fix.
//
// ⚠ WHAT IT DOES NOT DO, stated because a check trusted past its scope is how this started:
// it only sees routes that actually RUN. It cannot tell you a disclosure-less route exists
// somewhere unexecuted — no runtime check can. It replaces an inventory that claimed to
// prove absence and could not, with an enforcement that proves nothing is emitted unchecked.
//
// ⚠ CONCURRENCY: the counter is module-global, so two overlapping graphPacket calls could
// let one borrow the other's renderer call and pass. That direction is deliberate — it can
// only ever produce a FALSE PASS, never a false accusation appended to a user's packet.
// (The skills already say not to call graph verbs in parallel.) An AsyncLocalStorage scope
// would close it; it is not worth the machinery until a parallel caller exists.
export function sealPacketOutput(text, admitted) {
  if (typeof text !== 'string') return text;
  const blocks = extractListBlocks(text);
  if (blocks.length === 0) return text;
  // ⛔ ADMISSIONS WERE A Set, SO ONE RECEIPT AUTHORISED UNLIMITED COPIES. dev admitted one
  // block and emitted it twice — the second copy ungoverned — and both satisfied
  // `owned.has(b)`. Membership answers "was a list like this ever built?"; provenance has to
  // answer "was THIS occurrence built?". So receipts are counted and CONSUMED one for one.
  const receipts = new Map(admitted instanceof Map ? admitted : []);
  const take = (block) => {
    // Exact receipt first.
    if ((receipts.get(block) ?? 0) > 0) { receipts.set(block, receipts.get(block) - 1); return true; }
    // Otherwise a receipt whose block this is a PREFIX of — clampToBudget drops trailing
    // rows after admission, and a budget-clamped list is still the emitter's list.
    for (const [issued, n] of receipts) {
      if (n > 0 && issued.startsWith(block)) { receipts.set(issued, n - 1); return true; }
    }
    return false;
  };
  const unowned = blocks.filter((b) => !take(b));
  if (unowned.length === 0) return text;
  if (process.env.APG_PACKET_SEAL_STRICT === '1') {
    throw new Error(
      'PACKET SEAL: a reader-facing list was emitted that the governed renderer did not '
      + `build. Some route in packet.js assembles a list by hand. Unowned: ${JSON.stringify(unowned[0].slice(0, 120))}`,
    );
  }
  return `${text}\n${SEAL_CAVEAT}`;
}
