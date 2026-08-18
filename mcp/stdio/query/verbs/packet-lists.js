// GOVERNED LIST EMISSION — typed list occurrences carried to serialization.
//
// ⛔ FIVE VERSIONS OF THIS GUARANTEE WERE WRONG, each broken by graph-senior-dev-hermes
// EXECUTING a mutation. The sequence is worth keeping because the mistake never changed, only
// its disguise:
//
//   v1 grouped by FUNCTION      — a new branch inside graphPacket inherited credit.
//   v2 counted renderer calls   — one packet borrowed a concurrent packet's count.
//   v3 counted per-request      — a DUMMY call with unrelated arguments laundered a list.
//   v4 registered TEXT          — the registrar was exported, so any route minted its own
//                                 credential; and the "vocabulary-free" detector carried an
//                                 undocumented 80-char header bound that production crossed.
//   v5 hid the mint             — but `emitBoundedList(label, …)` took a FREE-FORM label, so
//                                 a route spelled 'CANDIDATES' through the bounded surface
//                                 and got candidate-shaped output with no population facts.
//                                 Category laundering. Its greedy prefix receipts also
//                                 FALSELY ACCUSED valid provenance when two admitted lists
//                                 shared a prefix.
//
// ★ Every version tried to recover ownership from TEXT after the fact — by counting calls
// near it, by matching strings, by grammar. Text has no author. I preregistered that if v5
// fell the conclusion was architectural rather than another patch, and it fell.
//
// ⇒ v6: a list is an OBJECT until the moment it is serialized. Ownership is object identity,
// which cannot be forged, borrowed, spelled or prefix-matched. Serialization consumes each
// object exactly once. No list grammar is an authority anywhere — the shape check survives
// only to REJECT raw strings, never to grant credit.
//
// ⇒ And validation happens AT SERIALIZATION, before clampToBudget runs. That is what retires
// dev's false-accusation finding outright: the clamp rewrites bounded sections, so any scheme
// that re-identified blocks in the clamped text was always going to accuse a healthy packet
// eventually.
import { AsyncLocalStorage } from 'node:async_hooks';

const sealScope = new AsyncLocalStorage();

let disclosureRenderCount = 0;
export const _disclosureRenderCount = () => disclosureRenderCount;

// ⛔ CLOSED SET, NOT A LABEL PARAMETER. v5's bounded emitter accepted any string, so
// `emitBoundedList('CANDIDATES', […])` produced a candidate-looking list carrying no
// population statement — dev ran it and strict graphPacket fulfilled. A free-form label IS a
// credential oracle: it lets a caller choose the category its text will be read as.
export const BOUNDED_KINDS = new Set([
  'READ FIRST', 'CONTRACTS', 'TESTS', 'RISKS', 'DEFINED IN', 'ALSO IN',
  'LAST TOUCHED', 'CO-CONSUMER FILES',
]);

// A list occurrence. Two of these with identical text are still two occurrences, which is why
// duplicate output cannot ride on one receipt — there are no receipts left to ride on.
class ListBlock {
  constructor(kind, header, rows, trailing = []) {
    this.kind = kind;
    this.header = header;
    this.rows = rows;
    this.trailing = trailing;
  }

  toText() {
    return [this.header, ...this.rows, ...this.trailing].join('\n');
  }
}

export const isListBlock = (x) => x instanceof ListBlock;

export async function withSealScope(fn) {
  // ⚠ REUSE AN ENCLOSING SCOPE RATHER THAN NESTING. A nested scope collected the serializations
  // and the OUTER check then saw none and accused its own healthy output. A false accusation
  // lands on a working answer and trains readers to ignore the line.
  const existing = sealScope.getStore();
  if (existing) {
    const out = await fn();
    return { out, scope: existing };
  }
  const scope = { serialized: 0 };
  const out = await sealScope.run(scope, fn);
  return { out, scope };
}

// ⛔ THE DISCLOSURE RENDERER. Not a credential — v3 proved a call proves nothing — but the
// single place the population wording is decided, so two branches cannot drift apart.
export function renderCandidateDisclosures({ shown, total, symbol, languages = [], exact = true }) {
  disclosureRenderCount += 1;
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
  // ⛔ THE REFERRER'S PROMISE IS WHAT A READER USES TO DECIDE WHETHER TO CALL. This line used
  // to read "every definition, unsampled" while graph_whereis capped at limit=5, so on any
  // symbol with more than five definitions the promise was false. The packet knows the
  // population as it writes this, so it emits the call that WOULD be unsampled.
  if (attested && total > shown) {
    out.push(`  NEXT: graph_whereis(symbol="${symbol}", limit=${total}) — every definition`
      + (exact === false ? ' (population is a FLOOR; raise the limit if it still warns)' : ''));
  }
  return out;
}

export function clampList(items, cap) {
  if (!items || items.length === 0) return { items: [], total: 0, truncated: false };
  return { items: items.slice(0, cap), total: items.length, truncated: items.length > cap };
}

// ★ CANDIDATE LISTS DERIVE EVERYTHING FROM POPULATION FACTS. There is no `header` argument to
// fake and no `disclosures` argument to omit — v4 had both, and dev's probe simply left the
// disclosures off. Header and disclosures now come out of one set of inputs, so they cannot
// contradict each other and obtaining the object IS computing the disclosure.
export function candidateList({
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
    // Exactness travels WITH the value — a capped population must not render as an exact one.
    exact: !populationIsFloor,
  });
  return new ListBlock('CANDIDATES', header, rows, disclosures);
}

// Bounded lists make no population claim; their contract is "these are the items, and
// truncation is stated". The KIND is checked against the closed set above, so this surface
// cannot be used to obtain candidate-shaped output.
export function boundedList(kind, capped, formatter = (x) => x) {
  if (!BOUNDED_KINDS.has(kind)) {
    throw new Error(`PACKET SEAL: "${kind}" is not a bounded list kind. Candidate lists must go `
      + 'through candidateList() so their population is stated; a free-form label is a way to '
      + 'obtain candidate authority without candidate facts.');
  }
  // Always render the header — even when empty — so agents can distinguish "broken packet"
  // from "no data of this kind". Empty sections render as `KIND: none`.
  if (capped.items.length === 0) return `${kind}: none`;
  const rows = capped.items.map((x) => `- ${formatter(x)}`);
  if (capped.truncated) rows.push(`- (${capped.total - capped.items.length} more — narrow target)`);
  return new ListBlock(kind, `${kind}:`, rows);
}

// Convenience for lists that are complete as given.
export function boundedListAll(kind, items, formatter = (x) => x) {
  return boundedList(kind, clampList(items, items.length), formatter);
}

// The shape of a reader-facing list, used ONLY to reject raw strings. It is never an
// authority: nothing is admitted because it matches, only refused because it does.
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
  '⚠ POPULATION NOT DISCLOSED — this candidate list came from a route that did not build it '
  + 'through the governed list emitter, so nothing above states how many matches exist. Treat '
  + 'the list as a FLOOR, not a total, and re-run graph_whereis(symbol=..., limit=N) before '
  + 'concluding anything about completeness. [packet seal]';

function violation(detail) {
  if (process.env.APG_PACKET_SEAL_STRICT === '1') throw new Error(`PACKET SEAL: ${detail}`);
  return false;
}

// ★★ SERIALIZATION IS THE ONLY PLACE A LIST BECOMES TEXT, AND THE ONLY PLACE OWNERSHIP IS
// DECIDED. Each ListBlock is consumed exactly once here; a plain string entry that is
// list-shaped was hand-assembled and is refused. This runs BEFORE clampToBudget, so the
// clamp's rewriting of bounded sections can no longer be mistaken for a provenance failure —
// which is precisely the false accusation greedy receipt matching produced in v5.
export function renderPacketLines(entries) {
  const scope = sealScope.getStore();
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry instanceof ListBlock) {
      if (scope) scope.serialized += 1;
      out.push(entry.toText());
      continue;
    }
    const text = String(entry);
    if (extractListBlocks(text).length > 0) {
      violation('a hand-assembled list reached serialization. Build it with candidateList() '
        + `or boundedList() instead: ${JSON.stringify(text.slice(0, 120))}`);
      out.push(`${text}\n${SEAL_CAVEAT}`);
      continue;
    }
    out.push(text);
  }
  return out.join('\n');
}

// ⚠ BACKSTOP ONLY, for a route that returns text WITHOUT going through serialization — which
// is exactly what every one of dev's probes did. If a packet shows a list and this scope never
// serialized one, no governed list was ever built.
//
// ⚠ It cannot do more than that, and does not claim to. Once output is text, the author is
// gone; that is the lesson five versions of this took to learn.
export function sealPacketOutput(text, scope) {
  if (typeof text !== 'string') return text;
  if (extractListBlocks(text).length === 0) return text;
  if (scope && scope.serialized > 0) return text;
  violation('a packet returned a reader-facing list without building one. Some route bypasses '
    + 'renderPacketLines() and assembles output by hand.');
  return `${text}\n${SEAL_CAVEAT}`;
}
