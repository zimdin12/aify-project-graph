---
name: graph-pull-context
description: Use when the user asks for everything connected to a file, feature, task, or symbol. Wraps `graph_pull` with intent-based layer selection and turns the JSON into a short cross-layer summary plus a read-next list.
trigger: tool_available("graph_status") OR tool_available("graph_pull") OR tool_available("graph_index")
---

# graph-pull-context

`graph_pull` is for **cross-layer context**, not for exact lookup and not for raw JSON dumping.

## Use it for

- “what all is connected to this?”
- file / feature / task / symbol context before a change
- combining code + features + tasks + activity in one view

## Layer defaults by intent

### Plan
Use:
```text
graph_pull(node="...", layers=["code","functionality","tasks","activity"])
```

### Debug
Use:
```text
graph_pull(node="...", layers=["code","functionality","activity"])
```

### Review / impact triage
Use:
```text
graph_pull(node="...", layers=["code","functionality","tasks","activity","docs"])
```

## Resolution preference

Prefer:
1. feature id
2. task id
3. exact file path
4. exact symbol

If input is vague, disambiguate first with `graph_whereis` or `graph_search`.

## Output discipline

Do not paste raw JSON unless asked. Summarize as:
- what was resolved
- what each requested layer says
- any gaps or truncation
- the next 1-3 files to read

## Do not

- request all layers by default
- use `graph_pull` instead of `graph_path` for execution traces
- use it instead of `graph_change_plan` when the task is already a clear code change
- treat feature/task matches as truth without reading at least one real file
