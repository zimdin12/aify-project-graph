# Final measurements before the disposable corpus is deleted

The pinned third-party corpus at `C:/Docker/apg-testbed` was built to test this tool against
repositories it did not write. It found defects that were **structurally invisible** on our own
repository. It is now being deleted, as instructed, so every number it produced is recorded here
first — the evidence has to outlive the instrument.

⚠ The corpus is **re-creatable**: `node scripts/testbed.mjs --setup` clones the same declared
commits, and `--verify` re-checks the pins. What is not re-created for free is `click`'s code-intel
collection, which takes a real pyright run.

## The pins

| arm | language | commit | tree |
|---|---|---|---|
| fmt | C++ | `e27cc20bd93a4e280fb9268d41cd131069a9c73f` | `d1e2972611908589b48e8a24d4871338d09a42f8` |
| click | Python | `68e7ea7228ca144c52e4d1d282cc09da59f7771f` | `2955d48825c98fd7dcbc60eb41cf18a952a2c0a3` |
| fast-route | PHP | `1c961398bef1ff6ecd8b273bef651d7afe90312b` | `f7c33a29ac1d10b73b9ef6a6bafbec2f453e738c` |
| p-queue | TypeScript | `180ab9e25cd10b6f548767d7176076b50d25e188` | `e8e63896c7368b45ead03441d007c76f2b2591e5` |

## Final state, all four arms reindexed at HEAD `27ed9d7`

Controls: **4 declared, 4 usable, all-arms-usable true.**

| arm | nodes | edges | file coverage | dangling | orphans | verified edges |
|---|---|---|---|---|---|---|
| fmt | 6,735 | 14,855 | c 1/1, cpp 73/73, js 1/1, py 4/4 — **100%** | **0** | 37 (0.5%) | 0 |
| click | 2,566 | 13,657 | python 79/79 — **100%** | **0** | 88 (3.4%) | **1,460 (10.7%)** |
| fast-route | 489 | 1,343 | php 47/47 — **100%** | **0** | 11 (2.2%) | 0 |
| p-queue | 184 | 384 | typescript 14/14 — **100%** | **0** | 8 (4.3%) | 0 |

Provenance mix:

    fmt          EXTRACTED 11,488   AMBIGUOUS 3,067   INFERRED 300
    click        EXTRACTED 10,976   LSP_VERIFIED 1,460   AMBIGUOUS 1,145   INFERRED 76
    fast-route   EXTRACTED  1,150   AMBIGUOUS   193
    p-queue      EXTRACTED    328   AMBIGUOUS    56

⚠ **Zero verified edges on fmt, fast-route and p-queue is not a defect** — no code-intel collection
was run on them. fast-route can *never* earn one: there is no PHP language server here, which is F4.

⚠ **Orphan shares rise as repositories shrink** (0.5% → 4.3%). Investigated and **not a defect**:
they are structural node types (Config, Entrypoint, BuildTarget) that participate in no edge by
nature, plus duplicate `Symbol` nodes sitting beside well-connected `Function` nodes.

## What the corpus found that our own repository could not

| finding | why our repo could not express it |
|---|---|
| F10 — collection writes out-of-repo `file://` URIs | we collect JavaScript here, so pyright never runs |
| F1 — `trust: "strong"` on 0 verified edges | needs a PHP arm, which can never earn a verified edge |
| F12 — confidence ranks above evidence tier | needs an arm with a real trust spine (only click) |
| F11 — "NO CALLERS" hid a whole unsearched relation | 272 at-risk labels in click alone |
| F8 — an interrupted index leaves a silent partial graph | observed on click after a killed run |

⇒ **A tool measured only against its own repository cannot see defects its own repository cannot
express.** The corpus paid for itself on its first real use.

## Framework fixtures — the second corpus

Minimal applications built in scratch and indexed by the real `scripts/reindex.mjs`. These verified
the resolver arc end to end. They are scratch and go with the teardown; the numbers are the record.

| fixture | routed edges | fully bound | the unbound ones |
|---|---|---|---|
| Express | 12 | **11 / 12** | `External:cors` — third-party, correct |
| FastAPI | 2 | **2 / 2** | — |
| Django | 2 | **2 / 2** | — |
| Laravel | 6 | **4 / 6** | `ThrottleRequests` — deliberately not defined |
| NestJS | 4 | **4 / 4** | — (includes the guard chain) |
| Rails | 2 | **2 / 2** | 6 actions the fixture does not define |
| Spring | 2 | **2 / 2** | — |
| Qt | 3 | **2 / 3** | `thirdPartySignal` — declared, never defined |

⭐ Every unbound edge is unbound **for a named, correct reason**. That is the point: the fixtures
demonstrate both that binding works and that it refuses to invent.

## The before state, for comparison

Recorded from the audit that opened this arc:

- `graph_callers("Class2")` said **NO CALLERS** while `graph_preflight("Class2")` said
  **CALLERS 1 total** — same graph, same symbol.
- `graph_preflight("Context")` showed **5 EXTRACTED test-file callers** while **124 LSP_VERIFIED**
  callers existed on that symbol.
- `graph_file("src/click/core.py")` rendered **40 edge lines, 0 with any provenance tag**, from 979
  candidates spanning three tiers.
- On a real Express app: **4 of 4 routed symbols** existed as both a `Function` node and an unlinked
  `External` twin; Flask and Django produced **0 routed edges at all**.
- `resources :articles` on a real Rails app produced **8 route nodes and 1 bound edge**.

## Open, and not closed by this arc

- **F4 (PHP language server)** is blocked on a licence, not engineering — Steven's call.
- **rails / spring** now have end-to-end fixtures; every framework does.
- `module_tree.js` still holds a hand-written `DEFINES`/`CONTAINS` pair — two uses in one file, left
  deliberately as low drift risk.
