# Attribution

## graphify

Patterns adapted from [safishamsi/graphify](https://github.com/safishamsi/graphify), MIT licensed.

Specifically:
- The compact NODE/EDGE line response format
- The high-intent named query verb surface
- The GRAPH_REPORT.md interface-first digest concept
- Top-K seed selection + bounded BFS depth + hard token-budget truncation

No source code is copied verbatim; these are design patterns reimplemented.

## Karpathy's LLM Wiki

The concept of "persistent structured artifact between model and raw sources" is inspired by Andrej Karpathy's [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). Our implementation addresses the failure modes identified in [this critique](https://medium.com/data-science-in-your-pocket/andrej-karpathys-llm-wiki-is-a-bad-idea-8c7e8953c618) by using deterministic tree-sitter extraction instead of LLM-generated content.
