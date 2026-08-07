# Graph freshness: make it somebody's job — v0.5.0 design

**Status:** design, approved 2026-08-07
**Supersedes:** the four architectural ideas evaluated and rejected below

## The problem, stated from evidence

Two repos, measured 2026-08-07:

| repo | staleness | consequence |
|---|---|---|
| `sand_castle` | 20 commits behind | sc-manager made **zero** graph calls in a full session, then concluded "it doesn't help" |
| `aify-project-graph` | **130 commits** behind | its own maintainer's queries answered from a snapshot four months old |

Neither is a bug in indexing. Both are the same organizational fact: **keeping the
graph current is nobody's job.** The mechanisms exist — `graph_index`,
`APG_AUTO_REINDEX`, `graph_watch`, and a `post-commit` hook installer — and none
of them were doing the work, because each requires someone to have decided,
once, to turn it on.

sc-manager's account of the failure mode is the one to design against:

> it's stale because I stopped using it, and then I used the staleness as the
> reason not to use it.

A tool that decays when unattended and requires attention to stop decaying will
lose. Freshness has to happen without anyone choosing it.

## What is already true (verified, not assumed)

Four things were checked before designing, and three of them killed a proposed
approach:

1. **The index is already shared.** One SQLite file per repo, WAL journal mode,
   readers open `readonly`. Concurrent processes do not block each other.
2. **Auto-reindex is already coordinated across processes.** `proper-lockfile` on
   `.aify-graph/.write.lock`, and after acquiring it each process re-reads the
   manifest and finds an empty change set. One indexes; the rest no-op. There is
   no thundering herd and no duplicated work.
3. **Language servers are per-process** — measured: two APG processes asking one
   code-intel question about one repo spawned **two** clangds. But
   `--background-index` is ON and the index persists to
   `.aify-graph/code-intel/.cache/clangd/index`, which the instances **share**.
   The expensive part is paid once; only in-memory preambles duplicate.
4. **Resource use is not a problem.** 429 MB across 6 APG processes on a 95 GB
   machine — 0.45%. The busiest process used 5.3 seconds of CPU in 3.5 days.

## Approaches rejected, with the evidence that killed them

**Shared language server per repo.** Motivated by an estimate of N × GB. Killed
by fact 3: the on-disk index is already shared, so the marginal cost of another
clangd is in-memory preambles, not another full index. Multiplexing a
single-client stdio protocol across N clients — including per-client document
state — is a large, corruption-prone build for a cost we have not shown hurts.

**Cross-process watcher election.** Elect one process to own `graph_watch` for a
repo via a lockfile. Killed on two counts. It needs liveness detection: when the
owner dies, no watcher runs and staleness returns silently — the exact bug being
fixed, reintroduced as a distributed-systems problem with heartbeats and stale-lock
timeouts. And it is subsumed: a git hook achieves the same outcome with no
election, no daemon, no filesystem handles, and is independent of how many
processes exist.

**One service per directory, connect-to-existing.** Its headline benefit
(fewer processes, less memory) addresses fact 4, which is not a problem. Its cost
is severe and specific: on 2026-08-07 two Claude Code sessions served answers
from three-day-old code for a full day, and the guard meant to catch that had
cached its own negative verdict. A per-directory service makes a long-lived
process the **default architecture** and removes the client-side restart that
currently fixes it. Rejected.

**Auto-reindex as the primary mechanism.** It works and it is correctly
coordinated, but it runs on the read path: a stale read blocks until the index
finishes, and behind any in-flight index too. The retry budget is ~3 minutes,
which a first index on a large C++ repo can exceed. It stays as a fallback, not
the primary.

## The design

### Principle

**Freshness is driven by the event that causes staleness, not by the reader who
suffers it.** HEAD moving is what makes the graph stale. Git already knows when
HEAD moves. So git triggers the refresh — off the critical path of any query,
once per repo regardless of how many agents are running, with no daemon and no
election.

### 1. Extend hook coverage to every event that moves HEAD

`scripts/install-graph-hook.mjs` installs `post-commit` only. That misses the
ways HEAD moves that are not a local commit:

| hook | covers | why it matters |
|---|---|---|
| `post-commit` | local commits | already implemented |
| `post-merge` | `git pull`, merges | how a teammate's work arrives |
| `post-checkout` | branch switches, `git checkout <sha>` | largest single jump in practice |
| `post-rewrite` | rebase, `commit --amend` | rewrites history under the snapshot |

All four run the same backgrounded incremental reindex. `post-checkout` fires on
file checkouts too, so it must check the third argument (`1` = branch checkout,
`0` = file checkout) and only act on branch changes.

### 2. Hook failures must be visible — the fail-closed requirement

The current hook body ends `>/dev/null 2>&1 &`. It discards every error. A
reindex that fails leaves the graph stale with nobody informed, which is the
exact silent-failure class v0.4.0 spent 137 commits eliminating. A refresh
mechanism that can quietly stop working is worse than none, because its presence
is used as the reason not to check.

The hook writes an outcome breadcrumb to `.aify-graph/last-refresh.json`:

```json
{
  "at": "2026-08-07T20:14:03Z",
  "trigger": "post-merge",
  "from": "88085d5",
  "to": "0b090ea",
  "status": "ok" | "failed",
  "error": "<first line of stderr, when failed>"
}
```

`graph_health` reads it and reports **degraded** when the most recent attempt
failed, or when the file is absent in a repo whose hooks **are** installed. Not
informational — degraded. Consistent with every other guard in this tool: a
mechanism whose health is unknown is not assumed healthy.

**A repo with no hooks installed is NOT degraded** — it is unconfigured, and
`graph_health` says so with the install command. The distinction matters and is
deliberate: fail-closed applies to a mechanism that is supposed to be running,
because silence from it is indistinguishable from success. A mechanism that was
never enabled is a known state, not an unknown one, and reporting every
un-hooked repo as degraded would make the signal worthless in exactly the repos
that later install hooks and need it to mean something.

### 3. Installation becomes part of setup, not an undocumented script

The installer exists and is idempotent; nothing tells anyone to run it. It gets a
step in `README.md` and every `install.*.md`, and `graph_health` names the exact
command when it detects hooks are absent in a git repo with `.aify-graph/`.

Hooks are per-clone and not carried by `git clone`, so this is per-machine setup
and must be stated as such.

### 4. Auto-reindex stays, demoted to fallback

`APG_AUTO_REINDEX` remains for uncommitted work and un-hooked repos. Documented
as a fallback with its cost named (blocks the read path), not as the recommended
mechanism.

## Non-goals

- No new long-lived process, daemon, or service.
- No cross-process leader election.
- No language-server multiplexing.
- No change to the MCP one-server-per-client deployment model.
- Not solving staleness for uncommitted working-tree changes beyond what dirty-file
  tracking already does — the hook cannot see edits that were never committed.

## Testing

1. **Each hook fires its event.** A fixture repo, install hooks, then perform
   commit / merge / branch-switch / amend and assert the breadcrumb records the
   right `trigger` and a `from`→`to` pair that matches the git transition.
2. **`post-checkout` ignores file checkouts.** `git checkout -- <file>` must not
   trigger a reindex; only branch changes do. This is the argument-3 check and it
   is the easiest part to get wrong.
3. **A failing reindex is reported, not swallowed.** Force the reindex to fail,
   assert the breadcrumb records `status: "failed"` with the error, and assert
   `graph_health` reports degraded.
4. **Absent breadcrumb with installed hooks reads as degraded**, not healthy —
   the fail-closed case, and the one that would otherwise let a silently-dead
   hook pass as fine.
5. **Idempotent install.** Running the installer twice leaves one aify block and
   preserves unrelated hook content, for all four hooks.
6. **Concurrent hook invocations serialize.** Two commits in quick succession
   must not corrupt the graph — the existing write lock should cover this, and
   the test states that it is covered rather than assuming it.

Every test must be verified to fail with the change reverted. The v0.4.0 record
contains two tests that asserted the buggy invariant they were meant to catch;
that is the failure mode this list exists to avoid.

## Open question deferred to implementation

Whether `graph_health` should offer to install hooks itself when it detects them
missing, or only name the command. Naming the command is the conservative default
and what this design assumes; auto-installation writes to `.git/hooks` without
being asked, which is a side effect a read-only-sounding verb should not have.
