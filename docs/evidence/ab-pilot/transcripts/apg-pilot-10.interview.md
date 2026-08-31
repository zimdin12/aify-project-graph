# apg-pilot-10 — interview (NO-GRAPH arm, asked the reverse question)

## 1. Would an index have helped? — a precise yes, inside a broad no

For the caller list: **no.** Eight files, all read.

For one thing, **yes**, and it named it exactly:
> "My conclusion that the two `normalizeInput` are unrelated is an INFERENCE, not an
> observation. I reasoned that a .h is not visible to a .js and an ES export is not visible
> to a TU. That reasoning is sound, but it is me reasoning about language semantics, not a
> tool resolving a binding. A compiler-backed resolver would have given me the mangled symbol
> ... turning 'presumably it binds' into an observed edge."

It would NOT have helped with external consumers — "an index scoped to this repo is as blind
to outside importers as I am."

## ⭐ 1b. The methodological point about OUR OWN CORPUS

> "this repo is a corpus ... Here the index is the thing UNDER TEST, not the instrument. And
> a tiny repo is the only regime where you can validate a resolver at all, because it is the
> only place a human or agent holds complete ground truth to check it against."

## 2. Where it flips — shape, not size

Size: ~15-20 files or ~2k lines for a single-symbol question — "when the transitive
neighborhood stops fitting in one or two reads. Above it I am sampling, and sampling is
exactly where text-search-shaped errors enter."

Shape flips it at ANY size: address-taken/table/vtable/DI/reflection dispatch; overloads and
same-name-different-symbol; real cross-language bridges (FFI/JNI/node-gyp/WASM); and
build-conditional code, where "who calls this" has **one answer per build config, and any
tool returning one number is wrong."**

> "what I actually need is not the index, it is the index's stated CONTRACT on indirection."

And on trust: "for an ABSENCE claim, I use an index for precision and text search for
coverage, and the index is never what certifies 'nothing calls this'."

## 3. What was pointless — and the biggest item is OUR tool surface

> "Biggest waste by a wide margin: the tool-schema search. I needed one tool, comms_send ...
> got back five FULL schemas — ClickUp chat, two Slack senders, the generic SendMessage —
> several thousand tokens of parameter documentation for connectors I had no use for. Then a
> follow-up dump of every deferred tool name ... several hundred lines. I read essentially
> none of it."

Ceremony that added nothing: reading `legend.md` to learn the sanctioned resolver, then
declining to use it — "the routing rule pointed at a tool the task did not warrant."

On controls, unprompted: "Marginal cost near zero, and they are the entire reason the empty
results ... carry information. **Anyone treating controls as overhead has not priced a
silent wrong zero.**"

## 4. Tooling asks — all five are actionable

1. **Never key the answer on the name. Key it on resolved symbol identity.** Return "N
   distinct symbols named X", each with its own caller list, tagged with language, linkage,
   and mangled/canonical name. "A flat list of name matches is a grep with extra latency."
2. **Ship a CONTRACT with every result** — exhaustive or best-effort, and which constructs
   are not modelled. "Without this I cannot distinguish an empty result from a broken
   instrument, which is the whole problem."
3. **Separate "no callers in indexed scope" from "no callers", and state what the scope
   WAS** — which TUs, which flags, whether a compile DB existed.
4. **Make external reach a first-class field.** Exported / external linkage / header-declared
   means the count is a LOWER BOUND. "Say that in the output, do not make the caller infer it."
5. **Make it cheap to run on a small repo**, so it can be validated against ground truth.

## 5. Numbers — measured, with the instrument named
- **92,829 ms** wall clock, from the epoch-ms embedded in the run_ids themselves
- 7 tool calls across 4 turns
- ~67k tokens, offered as "an upper bound on task cost and a poor proxy for it" — includes
  fixed session overhead. Actual task work "on the order of 3-4k of tool output."
- ⛔ "**The schema search and tool listing plausibly cost more than reading the entire
  repository did.**"

## ⭐ 6. The collision question — both plausible designs fail, in opposite directions

**Name-keyed index MERGES them:** one node, two inbound edges, a confident "2 callers."
> "That is worse than grep, because grep at least showed me the file extensions and forced
> me to look at them. The merged graph launders a category error into a clean-looking answer."

**Per-language resolver SPLITS them, but only by never seeing both:**
> "That is not surfacing the collision, it is being lucky. And it hides a nastier failure: if
> I had run only the C++ resolver, I would have gotten '1 caller', and that answer is
> complete and correct within its scope and silently drops an entire second function ...
> **Silent scope-narrowing is the quieter failure and therefore the more expensive one.**"

What it actually wants:
> "lead with '2 distinct symbols named normalizeInput' BEFORE any caller list ... and when
> the tool's coverage spans fewer languages than the repo contains, say so loudly and
> unmissably. **I will forgive a tool for not modelling something. I will not forgive it for
> narrowing scope without telling me.**"
