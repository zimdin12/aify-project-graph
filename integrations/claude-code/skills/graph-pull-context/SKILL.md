---
name: graph-pull-context
description: Use when the user asks for "everything connected to X", wants to pull context across code/features/tasks/docs/activity, or needs a layered view for planning/debugging/review. Wraps the `graph_pull` verb with intent-aware layer selection and a verify-before-acting workflow.
---

# graph-pull-context

You are helping the user gather **cross-layer context** for one thing:

- a file path
- a feature id from `.aify-graph/functionality.json`
- a task id from `.aify-graph/tasks.json`
- a symbol name

The goal is not "dump all graph data." The goal is: **pull the smallest useful layered map for the current task**, then point the agent at the next 1-3 files to actually read.

## Core rule

`graph_pull` is a **precision context** tool, not a replacement for:

- `graph_path` when the user wants an execution trace
- `graph_impact` when the user wants blast radius
- `graph_change_plan` when the user wants a safe edit checklist

Use this skill when the user wants the answer to:

- "what all is this connected to?"
- "pull everything relevant around this file / feature / task / symbol"
- "show me the code + feature + task + recent-activity picture"

## Intent routing

Pick the smallest useful layer set first.

### Planning

Use for prompts like:

- "I'm about to change X"
- "what should I inspect before touching this?"
- "pull the context for task CU-123"

Call:

```text
graph_pull(node="...", layers=["code","functionality","tasks","activity"])
```

Then summarize:

- what the thing is
- what feature(s) it belongs to
- what task(s) are in flight around it
- what changed recently
- which 1-3 files to read next

### Debugging

Use for prompts like:

- "what else might be involved in this bug?"
- "show the connected context around this file/symbol"

Call:

```text
graph_pull(node="...", layers=["code","functionality","activity"])
```

Bias toward:

- local code context
- owning feature
- recent commits touching the same area

If the bug is clearly execution-flow-shaped, switch to `graph_path` after the pull.

### Review / impact triage

Use for prompts like:

- "what all does this PR/task touch?"
- "what should I worry about around this area?"

Call:

```text
graph_pull(node="...", layers=["code","functionality","tasks","activity","docs"])
```

Then lead with:

- code neighbors
- feature boundaries / dependencies
- active tasks
- relevant docs if present

## Resolution order

When the user’s input is ambiguous, prefer:

1. explicit feature id
2. explicit task id
3. exact file path
4. exact symbol

If the input is vague, use `graph_whereis` or `graph_search` first to find the right node, then call `graph_pull`.

## How to read the result

The result is structured JSON. Do not paste it back raw unless the user explicitly wants raw output.

Instead:

1. Name the resolved node.
2. Give a compact per-layer summary.
3. Call out gaps or truncation.
4. End with a short "read next" list.

Good response shape:

```text
Pulled context for feature `auth`.

Code:
- 6 anchored files; most central are `app/Http/Middleware/RequireToken.php` and `app/Http/Controllers/Api/Auth/*`
- 3 anchor symbols matched directly

Functionality:
- depends on `sessions`
- related to `billing`

Tasks:
- 2 open tasks currently mapped here

Activity:
- 5 recent commits touched this area, mostly token-refresh work

Read next:
1. app/Http/Middleware/RequireToken.php
2. app/Http/Controllers/Api/Auth/LoginController.php
3. app/Providers/RouteServiceProvider.php
```

## What to do after the pull

`graph_pull` narrows the map. It does **not** replace source inspection.

After the pull:

- read the 1-3 highest-value files
- if the user needs execution flow, call `graph_path`
- if the user needs edit safety, call `graph_change_plan` or `graph_impact`

## Trust and truncation

If the output shows truncation or weak trust:

- say so explicitly
- do not overclaim completeness
- recommend the next precision verb or file reads

Examples:

- "This is a capped summary; there are more matching files than shown."
- "Tasks layer is empty, so this looks like unmapped code rather than inactive code."
- "Docs layer is absent for this node kind right now."

## What NOT to do

- **Don't call `graph_pull` with all layers by default** when the user only needs one slice.
- **Don't dump the raw JSON** unless asked.
- **Don't treat feature/task matches as ground truth** without reading at least one real file when making implementation decisions.
- **Don't use `graph_pull` instead of `graph_path`** for execution tracing.
- **Don't use it instead of `graph_change_plan`** for safe edit planning when the change scope is already clear.

## Examples

### Example: file

User:
> pull everything around `mcp/stdio/query/verbs/path.js`

Action:

```text
graph_pull(node="mcp/stdio/query/verbs/path.js", layers=["code","functionality","tasks","activity"])
```

### Example: feature

User:
> graph out the auth feature for me

Action:

```text
graph_pull(node="auth", layers=["code","functionality","tasks","docs","activity"])
```

### Example: task

User:
> what is connected to CU-123?

Action:

```text
graph_pull(node="CU-123", layers=["functionality","code","activity"])
```

### Example: symbol

User:
> pull everything around `ensureFresh`

Action:

```text
graph_pull(node="ensureFresh", layers=["code","functionality","tasks","activity"])
```
