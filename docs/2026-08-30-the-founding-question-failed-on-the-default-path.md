# The founding question failed on the default path

2026-08-30. `THE-GOAL.md` states the problem the product exists for:

> "my agents constantly forget where what files where. my agent asked me today where the game design
> doc is. he has worked on the project for 2 months already."

and names the base layer: *"file mapping and stuff is really important it is kind of basis for the
graph also."* Asked the three questions an agent would ask on this repository:

    graph_search("the goal")                        -> NO RESULTS
    graph_search("why is the rebuild one transaction") -> NO RESULTS
    graph_search("PHP language server decision")    -> NO RESULTS

**230 documents were indexed at the time.** `kind` defaults to `"code"`, which excludes `Document`
nodes, so the question the product exists to answer returned nothing on the only surface an agent
calls without being told to.

## Why the existing disclosure was not enough

The zero was not silent — it named the narrowing and gave the exact remedy:

> *Note: this verb DEFAULTS to kind="code" … Next: graph_search(query="…", kind="all")*

That is honest, and the repository had already been through one round of making it so. But THE-GOAL
also sets the bar: *"a disclosure nobody acts on"* is slop. Two facts decided it:

- the remedy costs a round trip to an agent whose entire problem is that it no longer remembers the
  document exists;
- **that message has been delivered zero times across 1,078 transcripts on this machine.** The twelve
  occurrences a first search found were all in this session's own transcript — my own calls, from
  minutes earlier. I nearly reported my own footprints as field evidence.

## What changed

**1. The default now widens.** When code matches nothing *and the narrowing was ours* — `kind`
defaulted, no `type` filter — the search re-runs across `Document`/`Directory`/`Config` and says so.
A caller who passed `kind:"code"` asked for code and still gets code; the source already
distinguished a supplied `'code'` from the chosen one, and this is the case that distinction was
built for.

**2. A prose question searches documents from the start.** Widening only on zero fixes the smaller
half — see the corpus measurement below, where the dominant failure was code *shadowing* the answer
rather than nothing matching. A multi-token query cannot be a symbol lookup (`EXACT_SYMBOL_RE` never
matches a string with a space), so it is a discovery question and gets the discovery population.

**3. Ranking learned where a token sits.** The scorer only ever compared against the *whole* query
string, so among documents the order was arbitrary — for "parameter types", click's
`parameter-types.md` and its `api.md` both scored exactly **100**, and the wrong one won on a
tie-break. A flat token count did not fix it either: `api.md` carries both tokens across its twelve
headings. A name or title is a claim about the whole document; a heading is a claim about one
section. Names and titles now score 200 per token, headings 40 — the repository's own
*adjacent, not ambient* rule, the property that separated the doc→symbol rules which survived
held-out grading from the one deleted at 0.9311.

## Measured on the pinned corpus

Ten questions, **registered before the corpus was indexed** and derived from what each library is
*for* — querying a repository's own headings after reading them tests that `LIKE` works, not that
discovery works.

| | correct document returned |
|---|---|
| before | **0 of 3** on this repo; **3–4 of 10** on the corpus |
| after | **6 of 10** on the corpus |

`shell completion` → `shell-completion.md` and `parameter types` → `parameter-types.md`, both of
which previously returned `api.md`. `testing commands` → `testing.md`, `format string syntax` →
`syntax.md`, `api reference` → `api.md`.

⚠ **And the count was nearly overstated.** An intermediate run scored 6 of 10 while two of those six
were the *wrong document* — the scoring rule registered in advance was "judged by reading it
afterwards", and applying it honestly gave 3–4, not 6. Counting documents returned is not counting
questions answered.

## What still does not work

- **Single-token discovery is still shadowed.** `context` and `arguments` return code, while
  `click-concepts.md` and `arguments.md` sit unreached. One word is genuinely ambiguous between a
  symbol lookup and a topic, and this change does not resolve it.
- **Natural-language questions with stopwords still miss.** `how do options work` matches nothing,
  because every token must appear and `options.md` contains no "how". `options.md` exists.
- **Document bodies are not indexed anywhere.** Filename, title and headings are the whole searchable
  surface. That is a real recall floor and every zero now says so.

## Two of my own tests were vacuous, and mutation caught it

The first version of the Step 3 tests passed against both key mutants:

- disabling the prose path entirely — because the fixture had no code matching the query, so the
  widen-on-zero path answered and the prose path was never exercised;
- weighting names and headings identically — because with equal scores the tie broke on row order,
  and the right document happened to be inserted first.

Both fixtures were corrected: the ranking fixture now inserts the heading-only document **first**, so
only the weighting can promote the right one, and adds a code node matching the same query, so only
the prose path can surface a document. Seven mutants across the three changes now all die.

## A prior decision reversed, deliberately

Three ★★★ tests asserted the opposite of change (1) — *"the title match does not fire for the DEFAULT
kind"*, *"one explanation per population"*, *"a bare call DOES disclose the default it applied"*. They
were written on purpose and are not wrong about their own world: explaining a population you did not
search is noise, and widening what someone asked to be a code search is answering a different
question.

What moved is the contract, not the standard. The default was never the caller's request. Each test
was rewritten to carry the new contract *with* its original reasoning, and the strongest part of the
old one is now pinned explicitly: **an explicit `kind:"code"` caller is never widened.**

⇒ This is a reversal of a deliberate prior decision, made without a reviewer available. It should be
the first thing checked.
