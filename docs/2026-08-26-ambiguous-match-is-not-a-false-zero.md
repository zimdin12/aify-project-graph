# `graph_callers` on an ambiguous name: disclosure, not a false zero

2026-08-26. Retires the last item carried as UNMEASURED on the standing list.

## The suspicion

From a field run on a third-party C++ corpus: `graph_callers("c_str")` on `fmt`'s most-called symbol
— 102 incoming edges — "returns ZERO callers", producing an AMBIGUOUS MATCH prompt for six
same-named definitions. It was recorded with an explicit instruction not to call it a defect before
measuring it, because a verb that answers *no callers* when it means *I could not choose* is the
absence-claim class this project has paid for more than any other.

That corpus has since been deleted. The **shape** is testable here.

## The population

Measured on this repository, with controls in the same pass (`readFileSync` → 123 CALLS edges, a
nonsense label → 0):

- **187** first-party names have more than one definition;
- **125** of those are both ambiguous *and* called — so the shape is present, and a zero here would
  have meant something.

The most ambiguous heavily-called names: `git` (26 definitions, 31 incoming), `sha` (11, 15),
`nodeText` (5, 15), `view` (2, 30).

## What the verb actually returns

Invoked, not reasoned about:

| input | result |
|---|---|
| `buildResolvers` (one definition) | the caller edges |
| `zzNotARealSymbolAnywhere` | `NO MATCH for "…". Try graph_search(…)` |
| `nodeText`, `git`, `sha`, `view` | `AMBIGUOUS MATCH for "…". N concrete candidates found:` |

The full text for `nodeText`:

    AMBIGUOUS MATCH for "nodeText". 5 concrete candidates found:
    - mcp::stdio::ingest::extractors::decorators::nodeText  mcp/stdio/ingest/extractors/decorators.js:1
    - mcp::stdio::ingest::languages::cpp::nodeText          mcp/stdio/ingest/languages/cpp.js:4
    - mcp::stdio::ingest::languages::php::nodeText          mcp/stdio/ingest/languages/php.js:3
    - mcp::stdio::ingest::languages::python::nodeText       mcp/stdio/ingest/languages/python.js:3
    - mcp::stdio::ingest::walker::nodeText                  mcp/stdio/ingest/walker.js:31
    Retry with a qualified symbol (Class::method / Namespace::Class::method) or use a file-specific query.

⇒ **NOT A DEFECT.** It names the ambiguity, enumerates every candidate with a qualified name and
`file:line`, and states the remedy. At no point does it assert that the symbol has no callers — which
is the thing that would have made it serious. An absent symbol likewise gets an explicit `NO MATCH`
with a next step, not silence.

## What is and is not claimed

- **Measured:** this repository, 125 ambiguous-and-called first-party names, four sampled by hand
  across 2–26 definitions, plus both controls.
- **Not measured:** the original C++ corpus, which no longer exists. The disambiguation lives in the
  query layer rather than in any extractor, so the same path serves every language — but that is a
  reading of where the code sits, not a run against C++, and it is recorded as such.
- The original observation was accurate about the *behaviour* (a prompt instead of a caller list) and
  wrong only in calling it "returns ZERO callers". Being handed five qualified candidates and a
  retry instruction is a different answer from being told nothing calls it.
