// THE STRUCTURAL DIGEST — the "before" the graph database does not keep, and the delta over two of
// them. Pure: no I/O, no database handle, no clock. Storage and rendering are somebody else's job.
//
// ⛔ WHY THIS EXISTS, verified in the schema 2026-09-06. The graph holds exactly ONE snapshot:
// `structural_fingerprints` is keyed `file_path PRIMARY KEY` and re-extracting a file REPLACES its
// row; `graph_generation` is `CHECK (id = 1)`. Nothing retains history, so "how did the shape change
// between these two commits" is unanswerable from the graph itself.
//
// ⭐ AND THAT IS PRECISELY WHY `graph_explain_diff` NEEDS NO HISTORY, which is the distinction this
// module exists to hold. That verb takes a GIT diff and maps changed FILES onto CURRENT symbols, so
// it answers "what does this diff TOUCH". It never sees the previous graph and therefore cannot
// answer "how did the shape CHANGE". Both are worth having; only the second is new, and conflating
// them would be the wrong-noun error this repository keeps paying for.
//
// ⭐ A DIGEST HOLDS ONLY WHAT A DELTA READS. Per-symbol fan-in/fan-out, edges keyed by their two
// symbol identities and the relation, the
// layer, and the file. Storing a whole graph per commit would grow without bound to answer a
// question that only needs aggregates.

/** Bumped when the digest SHAPE changes. Distinct from the extractor version, which is about inputs. */
// ⛔ BUMPED 1 -> 2 WHEN SYMBOL IDENTITY CHANGED. A v1 digest keyed symbols by qname alone, so it
// cannot be compared to a v2 one — the same symbol has a different name in each. `computeDelta`
// already refuses across versions, and that refusal is the correct outcome here rather than a
// regression: the alternative is a comparison that silently reports every symbol as removed and
// re-added.
export const DIGEST_VERSION = 2;

// ⛔ A QNAME IS NOT AN IDENTITY. The same qname occurs in several files — an overload, a declaration
// and its definition, the same method name in two modules — and keying on it alone merged those into
// one symbol carrying whichever file came first, then credited every edge to it. Identity is the
// qname AND where it lives.
//
// ⛔ AND THE SEPARATORS CANNOT BE CHARACTERS A NAME MAY CONTAIN. The previous edge key was
// `${from}>${to}` and its reader did `split('>')`. This product targets C++, where
// `std::vector<int>::push_back` contains `>` — so that split returned the wrong halves for every
// templated symbol and the lookup missed. No JavaScript fixture in this repository could show it,
// which is precisely why it survived. NUL and SOH cannot appear in a qname or a path.
const KEY_SEP = '\u0000';
const EDGE_SEP = '\u0001';

/** The identity of one symbol in a digest: what it is called AND where it lives. */
export const symbolKey = (qname, file) => `${qname}${KEY_SEP}${file ?? ''}`;

// The relation belongs in the key. Without it a CALLS and a REFERENCES between one pair collapsed
// to a single edge while fanIn counted both, so the digest disagreed with itself.
const edgeKey = (from, to, relation) => `${from}${EDGE_SEP}${to}${EDGE_SEP}${relation ?? ''}`;

/**
 * Build a digest from one graph observation.
 *
 * @param {object}   args
 * @param {string}   args.commit            the commit this graph was built from
 * @param {string}   args.extractorVersion  which extractor produced it — see computeDelta's refusal
 * @param {Array}    args.symbols           [{ qname, file, layer }]
 * @param {Array}    args.edges             [{ from, to, relation }] — `from`/`to` are `symbolKey`
 *                                          values; both ends must be in `symbols`
 * @returns {object} the digest, deterministic for a given graph regardless of input order
 */
export function buildDigest({ commit, extractorVersion, symbols = [], edges = [] }) {
  if (!commit) throw new TypeError('buildDigest: commit is required — a digest nobody can place is not a reading');
  if (!extractorVersion) {
    throw new TypeError('buildDigest: extractorVersion is required — a digest that cannot say what produced it can never be safely compared');
  }

  const table = {};
  for (const { qname, file, layer } of symbols) {
    // The qname is kept as a FIELD as well as part of the key: a reader still wants the name, and
    // deriving it back out of the key would mean parsing a separator in two places.
    table[symbolKey(qname, file)] = { qname, file, layer: layer ?? null, fanIn: 0, fanOut: 0 };
  }

  const keys = [];
  for (const { from, to, relation } of edges) {
    // ⛔ A DANGLING EDGE IS REFUSED, NOT COUNTED. Counting it would inflate fan-in for a symbol
    // nobody can look up, and that inflation reads as GROWTH on the next delta — a fabricated drift
    // signal, which is worse than a missing one because it invites action.
    if (!table[from]) throw new TypeError(`buildDigest: edge names unknown source symbol "${from}"`);
    if (!table[to]) throw new TypeError(`buildDigest: edge names unknown target symbol "${to}"`);
    table[from].fanOut += 1;
    table[to].fanIn += 1;
    keys.push(edgeKey(from, to, relation));
  }

  // ⭐ SORTED, BECAUSE A DELTA COMPARES DIGESTS ACROSS RUNS. If extraction order leaked into the
  // digest, every comparison would report churn that never happened and the drift signal would be
  // indistinguishable from noise.
  const ordered = {};
  for (const key of Object.keys(table).sort()) ordered[key] = table[key];

  return {
    digestVersion: DIGEST_VERSION,
    commit,
    extractorVersion,
    symbols: ordered,
    edgeKeys: [...new Set(keys)].sort(),
  };
}

/** A refusal carries no numbers: a reader handed figures alongside "I cannot attribute this" uses them. */
function refuse(reason) {
  return {
    comparable: false,
    refusal: reason,
    symbolsAdded: [], symbolsRemoved: [],
    edgesAdded: [], edgesRemoved: [],
    fanInMoved: [], newCrossLayerEdges: null,
    crossLayer: { available: false, symbolsWithLayer: null, symbolsTotal: null },
  };
}

/**
 * How the shape moved between two digests.
 *
 * @returns {object} `comparable:false` with a `refusal` when the two cannot be honestly compared.
 */
export function computeDelta(before, after) {
  // ⛔⛔ THE LOAD-BEARING RULE. A digest is only comparable to one from the SAME extractor. Change the
  // extractor and every number moves at once, and a delta would report that as the CODE changing.
  // This project has already shipped a feature that was inert on every existing graph through
  // exactly this coupling, so it is designed against here rather than discovered later.
  if (before.extractorVersion !== after.extractorVersion) {
    return refuse(`extractor version changed (${before.extractorVersion} to ${after.extractorVersion}) — `
      + 'every structural number moves when the extractor does, so this comparison cannot attribute '
      + 'movement to the code. Re-index the earlier commit with the current extractor to compare.');
  }
  // The same argument applies to the digest's own shape: fields may mean different things across
  // versions, and a silent comparison would be arithmetic over two different nouns.
  if (before.digestVersion !== after.digestVersion) {
    return refuse(`digest version changed (${before.digestVersion} to ${after.digestVersion}) — `
      + 'the two digests do not describe the same thing.');
  }

  const beforeNames = Object.keys(before.symbols);
  const afterNames = Object.keys(after.symbols);
  const beforeSet = new Set(beforeNames);
  const afterSet = new Set(afterNames);
  const beforeEdges = new Set(before.edgeKeys);
  const afterEdges = new Set(after.edgeKeys);

  // Fan-in movement is reported for every symbol present in EITHER digest, so a symbol that appeared
  // this commit shows its arrival (0 to N) rather than being silently skipped for lacking a before.
  const fanInMoved = [];
  for (const key of [...new Set([...beforeNames, ...afterNames])].sort()) {
    const entry = after.symbols[key] ?? before.symbols[key];
    const from = before.symbols[key]?.fanIn ?? 0;
    const to = after.symbols[key]?.fanIn ?? 0;
    if (from === to) continue;
    // ⭐ DIRECTION, NOT LEVEL. A snapshot cannot say whether fan-in 200 is a problem — it might be a
    // logger. "12 to 200" is the information nothing else holds.
    fanInMoved.push({ key, qname: entry?.qname ?? key, file: entry?.file ?? null,
      from, to, delta: to - from, direction: to > from ? 'grew' : 'shrank' });
  }

  // ⭐ THE SHAPE SIGNAL. A new edge that crosses a layer boundary is the class of change with no
  // local error signal: it fails months later, in someone else's task, unattributed. Reported only
  // for edges that are NEW and DO cross — a signal that fires on every edge is decoration.
  // ⛔ AND THE ANSWER IS WITHHELD ENTIRELY WHEN NOTHING CARRIES A LAYER. `layerOf` is optional and
  // defaults to null, so a digest built without an overlay labels nothing — and the loop below then
  // skips every pair and produces an empty list that reads as "we looked, there were none". That is
  // the dead-code shape this repository already names: a claim whose only witness is structurally
  // excluded. Undecidable is not zero, so it is reported as no answer rather than as an answer.
  const afterSymbols = Object.values(after.symbols);
  const symbolsWithLayer = afterSymbols.filter((s) => s.layer !== null && s.layer !== undefined).length;
  const crossLayer = {
    available: symbolsWithLayer > 0,
    symbolsWithLayer,
    symbolsTotal: afterSymbols.length,
  };

  const newCrossLayerEdges = [];
  for (const key of after.edgeKeys) {
    if (beforeEdges.has(key)) continue;
    const [from, to] = key.split(EDGE_SEP);
    const fromLayer = after.symbols[from]?.layer ?? null;
    const toLayer = after.symbols[to]?.layer ?? null;
    // Unknown layers are not a crossing. An absent layer is missing information, and treating it as
    // a boundary would make every unlabelled symbol look like an architecture violation.
    if (fromLayer === null || toLayer === null || fromLayer === toLayer) continue;
    newCrossLayerEdges.push({ from, to, fromLayer, toLayer });
  }

  return {
    comparable: true,
    refusal: null,
    // ⛔ IDENTITY, BUT READABLE. The key carries a separator no reader should ever see, so the
    // arrivals and departures are reported as the pair that identifies them. A bare key would push
    // control characters into the dashboard and into every /api/delta response.
    symbolsAdded: afterNames.filter((n) => !beforeSet.has(n)).sort()
      .map((k) => ({ qname: after.symbols[k].qname, file: after.symbols[k].file })),
    symbolsRemoved: beforeNames.filter((n) => !afterSet.has(n)).sort()
      .map((k) => ({ qname: before.symbols[k].qname, file: before.symbols[k].file })),
    edgesAdded: after.edgeKeys.filter((k) => !beforeEdges.has(k)),
    edgesRemoved: before.edgeKeys.filter((k) => !afterEdges.has(k)),
    fanInMoved,
    newCrossLayerEdges: crossLayer.available ? newCrossLayerEdges : null,
    crossLayer,
  };
}
