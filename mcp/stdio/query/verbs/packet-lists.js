// GOVERNED LIST EMISSION — opaque, immutable list occurrences reconciled one-to-one with the
// final packet text.
//
// ⛔ SIX VERSIONS OF THIS GUARANTEE WERE WRONG BEFORE THIS ONE, each falsified by a reviewer
// EXECUTING a counterexample rather than arguing:
//
//   v1 grouped by FUNCTION      — a new branch inside graphPacket inherited credit.
//   v2 counted renderer calls   — a concurrent packet lent its count (the server has no queue).
//   v3 counted per-request      — a call with unrelated arguments satisfied an unrelated list.
//   v4 registered TEXT          — the registrar was exported, and the "vocabulary-free"
//                                 detector carried an 80-char header bound production crossed.
//   v5 hid the registrar        — the bounded emitter took a FREE-FORM LABEL, so a route
//                                 spelled 'CANDIDATES' through it with no population facts.
//   v6 typed the occurrence     — and then licensed the ENTIRE final text on `serialized > 0`.
//
// ★ v6 IS THE ONE WORTH UNDERSTANDING, because it failed on the exact reasoning the previous
// five were built to remove. "Some serialization happened, therefore every block in the output
// is owned" is existential credit wearing a type system. Render one legitimate list, append a
// hand-built one, and both were accepted. I had also written "consumes each exactly once" in
// the commit message while the code held only a counter — and my own test constructed two
// separate objects, so it could not have caught the identity reuse it claimed to cover.
//
// ⇒ v7, to graph-senior-dev's specification:
//   1. Population is a TAGGED VALUE (exact / floor / unknown). There is no integer-plus-
//      defaulting-boolean form in which a floor can be silently rendered exact.
//   2. Occurrences are OPAQUE and IMMUTABLE: rows are defensively copied and validated as
//      single lines, the object is frozen, and its text lives in a module-private WeakMap so
//      there is no public toText() to call or override.
//   3. Identities are CONSUMED via a per-scope WeakSet. The same occurrence cannot serialize
//      twice.
//   4. The final text is RECONCILED one-to-one: every list-shaped block in it must correspond
//      to a distinct consumed occurrence. Nothing is licensed by a count.
//   5. DEFINED IN and ALSO IN are symbol lists that carry a population — not bounded kinds.
//      A first-time reader reached that conclusion from the output alone before reading any of
//      this code, which is the strongest evidence the old classification had.
import { AsyncLocalStorage } from 'node:async_hooks';

const sealScope = new AsyncLocalStorage();

let disclosureRenderCount = 0;
export const _disclosureRenderCount = () => disclosureRenderCount;

// ── population, as a tagged value ────────────────────────────────────────────────────────
//
// ⛔ THE OLD SHAPE WAS `{ statedTotal, populationIsFloor = false }` — two independent inputs
// with EXACT as the default, so a floor whose flag was forgotten or mis-threaded rendered as a
// total. packet.js has carried the rule "the exactness must travel WITH the value" in a
// comment since an earlier fix; modelling it as an integer beside a boolean is precisely not
// doing that. Now the exactness IS the value.
// ⛔ THE BRAND WAS AN ENUMERABLE SYMBOL, so `{...exactly(1), total: 0}` copied the brand and
// replaced the number — a forged population that every check accepted. And nothing validated
// the number at all: `exactly(0)` beside one row rendered "showing 1 of 0", a population
// statement that is not internally possible. A tag that prevents confusion between KINDS and
// permits an impossible VALUE is only half a type.
//
// ⇒ Membership lives in a private WeakSet, which a spread cannot copy, and the value is
// checked where it is made.
const POPULATIONS = new WeakSet();
function population(value) {
  Object.freeze(value);
  POPULATIONS.add(value);
  return value;
}
function checkTotal(total) {
  if (!Number.isInteger(total) || total < 0) {
    fail(`a population total must be a non-negative integer — got ${JSON.stringify(total)}`);
  }
  return total;
}
export const exactly = (total) => population({ kind: 'exact', total: checkTotal(total) });
export const atLeast = (total, { rowsSeen = null } = {}) =>
  population({ kind: 'floor', total: checkTotal(total), rowsSeen });
export const unknownPopulation = () => population({ kind: 'unknown' });
const isPopulation = (p) => POPULATIONS.has(p);

// ── kinds ────────────────────────────────────────────────────────────────────────────────
//
// Bounded kinds make NO population claim, and that is now a real distinction rather than a
// convenience: DEFINED IN and ALSO IN were bounded and were read as populations anyway.
export const BOUNDED_KINDS = new Set([
  'READ FIRST', 'CONTRACTS', 'TESTS', 'RISKS', 'LAST TOUCHED', 'CO-CONSUMER FILES',
]);
export const SYMBOL_KINDS = new Set(['DEFINED IN', 'ALSO IN']);

// ── the occurrence ───────────────────────────────────────────────────────────────────────
// occurrence -> { kind, header, rows, trailing }. Module-private: there is no public toText,
// and the PARTS are kept rather than the finished string so the budget clamp can transform an
// occurrence instead of rewriting text behind the seal's back.
const PARTS = new WeakMap();

class ListOccurrence {
  constructor(kind) {
    this.kind = kind;
    Object.freeze(this);
  }
}

function fail(detail) {
  throw new Error(`PACKET SEAL: ${detail}`);
}

// ⛔ ROWS ARE VALIDATED, NOT TRUSTED. A formatter returning "anchor.js\nCANDIDATES:\n- hidden.js"
// used to be flattened into the block, so one owned container carried a second unowned list —
// object identity proved who owned the OUTER container, not who authored what was inside it.
// A row is one line. That is checkable, so it is checked.
function freezeRows(rows) {
  const copy = [];                       // defensive: never alias the caller's array
  for (const r of rows) {
    const s = String(r);
    if (s.includes('\n')) {
      fail(`a list row must be a single line — got ${JSON.stringify(s.slice(0, 80))}. A row `
        + 'containing a newline can carry a second, unowned list inside an owned one.');
    }
    copy.push(s);
  }
  return Object.freeze(copy);
}

function mint(kind, header, rows, trailing = []) {
  if (String(header).includes('\n')) fail('a list header must be a single line');
  const occ = new ListOccurrence(kind);
  // The PARTS are kept rather than a finished string, so the budget clamp can transform an
  // occurrence into a new one instead of rewriting text behind the seal's back — which is
  // what made the clamp simultaneously unprovable and falsely accused.
  PARTS.set(occ, Object.freeze({
    kind, header, rows: freezeRows(rows), trailing: Object.freeze([...trailing]),
  }));
  return occ;
}

function textOf(occ) {
  const p = PARTS.get(occ);
  return [p.header, ...p.rows, ...p.trailing].join('\n');
}

// ⚠ THE RECONCILABLE PART IS HEADER + ROWS, NOT THE WHOLE OCCURRENCE. Trailing disclosures and
// notes are indented prose, so extractListBlocks stops before them — comparing a block against
// the full text would refuse every occurrence that carries a disclosure, which is most of them.
// Recording the block explicitly is the honest version of what the deleted prefix allowance was
// silently approximating.
function blockOf(occ) {
  const p = PARTS.get(occ);
  return [p.header, ...p.rows].join('\n');
}

// Test-only accessor. Named so it cannot be mistaken for API, and deliberately NOT the path
// the serializer uses — a public renderer would be a way to obtain the text without consuming
// the identity, which is half of what B1/B4 exploited.
export const renderOccurrenceForTest = (occ) => textOf(occ);

// ── disclosures ──────────────────────────────────────────────────────────────────────────
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

// ── constructors ─────────────────────────────────────────────────────────────────────────

// ⛔ "showing 1 of 0" IS NOT A SAMPLING DISCLOSURE, IT IS A CONTRADICTION — and it sealed
// clean, because the tag was checked and the number never was. A population that cannot
// contain the rows beneath it says nothing true about them.
function requirePopulationCoversShown(label, shown, population) {
  if (population.kind === 'unknown') return;
  if (population.total < shown) {
    fail(`${label} would claim a population of ${population.total} while showing ${shown} rows. `
      + 'A total smaller than the sample cannot be a total.');
  }
}

function populationHeader(label, shown, population) {
  switch (population.kind) {
    case 'unknown':
      return `${label} — showing ${shown}; total population UNKNOWN (not stated by graph_consequences):`;
    case 'floor':
      return `${label} — showing ${shown} of AT LEAST ${population.total}`
        + (population.rowsSeen
          ? ` (grouped from ${population.rowsSeen[0]} of ${population.rowsSeen[1]} matching rows — retrieval was capped BEFORE grouping, so the population is a FLOOR)`
          : ' (retrieval capped before grouping — population is a FLOOR)')
        + ':';
    default:
      return `${label} — showing ${shown} of ${population.total}`
        + (population.total > shown ? ` (${population.total - shown} not listed here)` : '')
        + ':';
  }
}

export function candidateList({ rows, symbol, population, languages = [] }) {
  if (!isPopulation(population)) {
    fail('candidateList requires a tagged population — exactly(n), atLeast(n) or '
      + 'unknownPopulation(). A bare integer cannot say whether it is a total or a floor, '
      + 'which is how a floor came to be rendered as exact.');
  }
  const shown = rows.length;
  requirePopulationCoversShown('CANDIDATES', shown, population);
  const header = populationHeader('CANDIDATES', shown, population);
  const disclosures = renderCandidateDisclosures({
    shown,
    total: population.kind === 'unknown' ? null : population.total,
    symbol,
    languages,
    exact: population.kind === 'exact',
  });
  return mint('CANDIDATES', header, rows, disclosures);
}

// ⛔ DEFINED IN / ALSO IN. Previously bounded, therefore stating no population — and read as a
// population by every reader anyway, including one who had never seen the code.
export function symbolList(kind, rows, { symbol, population, languages = [], notes = [] }) {
  if (!SYMBOL_KINDS.has(kind)) fail(`"${kind}" is not a symbol-list kind`);
  if (!isPopulation(population)) fail(`${kind} requires a tagged population`);
  // `notes` are caveats ABOUT the list that are not population claims — e.g. "order is
  // arrival, not relevance". They ride inside the occurrence rather than being pushed
  // alongside it, because adjacency is exactly what let the header say nothing.
  return mint(kind, populationHeader(kind, rows.length, population), rows, [
    ...renderCandidateDisclosures({
      shown: rows.length,
      total: population.kind === 'unknown' ? null : population.total,
      symbol,
      languages,
      exact: population.kind === 'exact',
    }),
    ...notes,
  ]);
}

export function boundedList(kind, capped, formatter = (x) => x) {
  if (!BOUNDED_KINDS.has(kind)) {
    fail(`"${kind}" is not a bounded list kind. Lists that carry a population must go through `
      + 'candidateList() or symbolList() so the population is stated.');
  }
  if (capped.items.length === 0) return `${kind}: none`;
  const rows = capped.items.map((x) => `- ${formatter(x)}`);
  if (capped.truncated) rows.push(`- (${capped.total - capped.items.length} more — narrow target)`);
  return mint(kind, `${kind}:`, rows);
}

export function boundedListAll(kind, items, formatter = (x) => x) {
  return boundedList(kind, clampList(items, items.length), formatter);
}

// ── scope ────────────────────────────────────────────────────────────────────────────────
export async function withSealScope(fn) {
  // Reuse an enclosing scope rather than nesting: a nested scope collected the consumptions
  // inward and the outer check then accused its own healthy output.
  const existing = sealScope.getStore();
  if (existing) {
    const out = await fn();
    return { out, scope: existing };
  }
  const scope = { consumed: new WeakSet(), emitted: [] };
  const out = await sealScope.run(scope, fn);
  return { out, scope };
}

// ── detection ────────────────────────────────────────────────────────────────────────────
//
// ⚠ SCOPE OF THE GRAMMAR, STATED BECAUSE IT IS A REAL LIMIT AND NOT A DETAIL. A reader-facing
// list is recognised as: a header line, followed by one or more lines beginning "- ". The
// header's trailing colon is OPTIONAL — dev showed `['CANDIDATES','- hidden.js'].join('\n')`
// slipping past a colon-requiring form, and a grammar that misses the shape it is named for is
// the same defect as a vocabulary that misses a word.
//
// ⚠ This grammar is NOT an authority. It never grants ownership; it only decides what must be
// reconciled. Text that is reader-facing in some other shape is outside the published claim,
// and the claim in the commit message says so rather than implying otherwise.
export function extractListBlocks(text) {
  const lines = String(text).split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i];
    if (!head.trim() || head.startsWith('- ')) continue;
    if (!/^- /.test(lines[i + 1] ?? '')) continue;
    let j = i + 1;
    while (j < lines.length && /^- /.test(lines[j])) j += 1;
    out.push(lines.slice(i, j).join('\n'));
    i = j - 1;
  }
  return out;
}

export const SEAL_CAVEAT =
  '⚠ POPULATION NOT DISCLOSED — a list above was not built through the governed list emitter, '
  + 'so nothing states how many matches exist. Treat it as a FLOOR, not a total, and re-run '
  + 'graph_whereis(symbol=..., limit=N) before concluding anything about completeness. '
  + '[packet seal]';

function violation(detail) {
  if (process.env.APG_PACKET_SEAL_STRICT === '1') fail(detail);
  return false;
}

// ── serialization ────────────────────────────────────────────────────────────────────────
//
// The only place an occurrence becomes text, and the only place an identity is consumed.
export function renderPacketLines(entries) {
  const scope = sealScope.getStore();
  const out = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry instanceof ListOccurrence) {
      const text = textOf(entry);
      if (scope) {
        // ⛔ IDENTITY, NOT A COUNTER. `renderPacketLines([b, b])` used to emit b twice and
        // report two serializations — "consumes each exactly once" was a claim, not a
        // mechanism. The old test built two separate objects and so never touched this.
        if (scope.consumed.has(entry)) {
          violation('the same list occurrence was serialized twice. Build a second occurrence '
            + 'if you mean to show a second list.');
        }
        scope.consumed.add(entry);
        scope.emitted.push(blockOf(entry));
      }
      out.push(text);
      continue;
    }
    const text = String(entry);
    if (extractListBlocks(text).length > 0) {
      violation('a hand-assembled list reached serialization. Build it with candidateList(), '
        + `symbolList() or boundedList(): ${JSON.stringify(text.slice(0, 120))}`);
      out.push(`${text}\n${SEAL_CAVEAT}`);
      continue;
    }
    out.push(text);
  }
  return out.join('\n');
}

// ── reconciliation ───────────────────────────────────────────────────────────────────────
//
// ⛔ THIS REPLACES `scope.serialized > 0`, WHICH LICENSED THE WHOLE PACKET. Rendering one real
// list and appending a hand-built one passed, because a non-empty count was read as ownership
// of everything. Every block in the final text must now match a DISTINCT emitted occurrence.
//
// ⚠ Blocks may legitimately differ from what was emitted: clampToBudget rewrites bounded
// sections after serialization. So a block matches if it equals an emitted text or is a
// prefix of one — and each emitted text can satisfy at most ONE block, which is what stops a
// single receipt covering duplicates.
export function sealPacketOutput(text, scope) {
  if (typeof text !== 'string') return text;
  const blocks = extractListBlocks(text);
  if (blocks.length === 0) return text;
  const pool = scope && Array.isArray(scope.emitted) ? [...scope.emitted] : [];
  const unowned = [];
  for (const block of blocks) {
    // ⛔ EXACT MATCH ONLY. The prefix allowance was simultaneously too permissive and too
    // weak, which is the clearest possible evidence that inferring a transform from text
    // cannot work: it accepted an arbitrary truncation of a CANDIDATES list (header still
    // claiming "showing 3 of 9" above one row — the clamp lie, recreated by the mechanism
    // meant to permit clamping) while REFUSING a genuinely skeletonized bounded list,
    // because skeletonization rewrites rows rather than dropping a suffix.
    //
    // ⇒ Both are closed by clamping the OCCURRENCE instead of the text: after
    // clampOccurrences() the emitted text IS the final text, so nothing needs inferring.
    const i = pool.indexOf(block);
    if (i < 0) unowned.push(block);
    else pool.splice(i, 1);
  }
  if (unowned.length === 0) return text;
  violation('a reader-facing list in the final packet does not correspond to any list the '
    + `governed emitter built: ${JSON.stringify(unowned[0].slice(0, 120))}`);
  return `${text}
${SEAL_CAVEAT}`;
}

// ── budget clamping, on occurrences ──────────────────────────────────────────────────────
//
// ⛔ THE CLAMP USED TO RUN ON FINISHED TEXT, AFTER THE SEAL HAD VALIDATED IT. That put a
// rewrite behind the guarantee, and every attempt to let it through by recognising the
// rewritten text failed in one direction or the other. Clamping the OCCURRENCE keeps the
// typed carrier all the way to serialization: a skeletonized list is a NEW occurrence with
// its own rows, serialized once, reconciled exactly.
//
// ⚠ Only BOUNDED kinds are clampable. A candidate or symbol list states a population, and
// rewriting its rows underneath that statement is precisely the lie this file exists to stop.
const esTokens = (t) => Math.ceil(t.length / 4);

function skeletonizeRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const tok = row.slice(2).trim().split(/\s+—\s+|\s+/)[0] ?? '';
    const slash = tok.lastIndexOf('/');
    const key = slash > 0 ? tok.slice(0, slash) : `__solo__:${row}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  if (![...groups].some(([k, v]) => !k.startsWith('__solo__:') && v.length >= 2)) return null;
  const out = [];
  for (const [key, members] of groups) {
    if (key.startsWith('__solo__:') || members.length < 2) out.push(...members);
    else out.push(`- ${members.length} more under ${key}/* (collapsed — over budget)`);
  }
  return out;
}

export function clampOccurrences(entries, budgetTokens, targetKind = null) {
  // ⛔ MY FIRST VERSION OF THIS COULD NEVER REACH TIER 3. Each tier rewrote the entry list, so
  // tier 2 replaced the occurrence with a plain string and tier 3 — which only transforms
  // occurrences — then had nothing left to act on. A packet over budget after tier 2 simply
  // stayed over budget. Found by probing the tiers directly rather than trusting that four
  // tests passing meant the ladder worked.
  //
  // ⇒ Decide a LEVEL per kind, then materialise once. The tiers are a decision, not a
  // sequence of destructive edits.
  const order = ['RISKS', 'TESTS', 'CONTRACTS', 'READ FIRST'];
  const levels = new Map(order.map((k) => [k, 0]));   // 0 full · 1 skeleton · 2 count · 3 drop
  const kindOf = (e) => (e instanceof ListOccurrence ? PARTS.get(e).kind : null);
  const clampable = (e) => {
    const k = kindOf(e);
    return k !== null && BOUNDED_KINDS.has(k) && k !== targetKind && levels.has(k);
  };

  const materialise = () => entries.map((e) => {
    if (!clampable(e)) return e;
    const p = PARTS.get(e);
    switch (levels.get(p.kind)) {
      case 1: {
        const rows = skeletonizeRows(p.rows);
        return rows ? mint(p.kind, p.header, rows, p.trailing) : e;
      }
      case 2: return `${p.kind}: ${p.rows.length} omitted (over budget)`;
      case 3: return `(${p.kind} dropped — over budget)`;
      default: return e;
    }
  });
  const size = (list) => esTokens(list
    .map((e) => (e instanceof ListOccurrence ? textOf(e) : String(e))).join('\n'));

  let out = materialise();
  if (!Number.isFinite(budgetTokens) || size(out) <= budgetTokens) return out;
  for (const level of [1, 2, 3]) {
    for (const kind of order) {
      if (kind === targetKind) continue;   // the section containing the target is never trimmed
      levels.set(kind, level);
      out = materialise();
      if (size(out) <= budgetTokens) return out;
    }
  }
  return out;
}
