# Preregistration — does any verb output send an agent to a verb it cannot call?

**Written:** 2026-09-02, before the scan was built or run.

## Why

Three places in the repo cite a **"remedy-reachability guard"** — *"a LISTED verb must not name an
UNLISTED one"* (`callees.js:117`, `callers.js:102`, `absence-names-its-population.test.js:147`). I can
find no executable check that enforces it generally; what exists is one instance assertion (that
`graph_callers`' output names `graph_impact` rather than the unlisted `graph_preflight`).

⚠ That is **my** absence claim about the codebase, and absence claims are the defect class that has
cost me most here. The scan below is what turns it into a measurement.

This matters for the product, not just tidiness. The measured adoption bottleneck is **mid-task
reach**: agents do not invoke skills mid-task, and the one surface they reliably read is **verb
output**. A remedy in that output naming a verb the agent cannot call is a **dead end** — the exact
defect class M1 was built to kill, in the routing half of the product.

## Question

Across the verb outputs I can actually produce, does any name a `graph_*` / `code_intel_*` verb that
is absent from the default `tools/list`?

## Population

Outputs obtainable through `tools/call` on `tests/fixtures/identity-hostile`, indexed, from a spawned
server: the ambiguity refusal (`graph_callers` on a bare name) and the absence outputs of all five
absence consumers (`callers`, `callees`, `impact`, `neighbors`, `trace`).

⚠ These are the outputs I can *trigger*, not all outputs the product can emit. Stated here so the
claim cannot later be read as repo-wide.

## Identity rule

- **Named verb** = a token matching `(graph|code_intel)_[a-z_]+` in the output text that is **also a
  registered tool name** in `mcp/stdio/tools/schema.js`. Requiring registry membership stops the
  regex inventing verbs out of prose.
- **Unreachable** = that name is absent from the default-profile `tools/list`.

## Finding schema

One row per occurrence: `{ producingVerb, namedVerb, registered, listed }`.

## Controls, same pass

- **POSITIVE — the outputs name verbs at all.** If zero verbs are extracted, "no unreachable
  remedies" is vacuous. At least one output must name a verb known to be present
  (`code_intel_references` appears in the absence text).
- **POSITIVE — the listing is non-empty**, or every name scores unreachable for the wrong reason.
- **NEGATIVE — the matcher rejects a non-verb.** An invented token must not be classified as a named
  verb.
- **REGISTRY CROSS-CHECK — every extracted token is a real registered tool.** A token that matches the
  shape but is not in the registry means the regex is over-reaching, and that must surface rather
  than inflate the count.

## Claim ceiling

Scans **text I could trigger from one fixture**. It cannot show that no output anywhere names an
unlisted verb, and it says nothing about whether an agent would actually follow a remedy it can
reach. It measures reachability of the pointer, not the usefulness of the advice.

## Abandon rule

If no output names any verb, report the scan as **unable to run** and conclude nothing — do not
report a clean zero.

## Decided in advance

- **Zero unreachable remedies** → the invariant holds on this population; add a gate so it stays that
  way, and correct the three comments that describe a guard which does not exist as code.
- **Any unreachable remedy** → a mid-task dead end, and a P0 for the routing half: the output sends an
  agent to a verb it cannot call.
