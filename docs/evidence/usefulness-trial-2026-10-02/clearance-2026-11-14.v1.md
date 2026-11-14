# Eight-task preparation, 2026-11-14

## Result and hold

The eight candidates are frozen in `selection-2026-11-14.v1.json`, with full target and single-parent base commits. The structural check passes against the imported map. The selected maximum is three tasks in live-code-intel.

Eligibility is **NOT CERTIFIED**. All eight verdicts are UNVERIFIED. Positive parent-session authoring events were found, but the inspected history does not establish complete grader independence. An empty targeted search and the shared Git byline are not clearance. UNVERIFIED does not mean a conflict was proven. It means the task cannot yet count toward the eight eligible tasks.

This completes the requested preparation with an uncertified conclusion. It does not authorize or start a pilot, trial arm, spend, service operation or grader relaunch. No APG runtime behavior changed. Answer keys, decision points, masking, complete carriers, instruments, live coverage and pilot costing are outside this preparation and remain prerequisites to execution.

## Frozen sources

- APG population cutoff: `c3dbb3ebd2ec44fc26a1f82c120d1f0536521be4`.
- Map created at `59cbae3a6c77d673960562b90a67c18a5e99d8b5`, imported at `550643ef8379b78517c918b6e2e71b3914426226`. Both contain `.aify-graph/functionality.json` blob `89bd13b5299742b0bf225ab4abc0cf03242d344f`.
- Owning protocol: aify-dashboard `docs/PREREGISTRATION-v0.8.md`, read at `67dc0a703d615caf63d5340d8caee2f49422e5e3`. The same blob, `3c2306300282bed4d5631c7e7c5dc9e3fe679067`, is present at owning PLAN revision `2c1a2589084a17465d8ae7b3ca3681b2eed1dd41`.
- Protocol sections used: start rule, lines 205-221; coverage, 223-229; role and grader exclusion, 263-281. The grader must not have written or reviewed a selected merged solution. Review shaping a fix before code counts too.
- Assignment: recorded request `1794661347949-58d70c2f`, APG dashboard task #2. Preparation only. The requested delivery target was 2026-11-15 UTC.

## Selection and per-task audit

The JSON is the authoritative list of full target/base identities, exact file anchors, authoring-event pointers, review records read and verdicts. The following table summarizes those rows without creating a second full-ID list.

| ID | Target prefix | Change | Mapped feature | Verdict |
|---|---|---|---|---|
| T1 | 6a367db8 | Refuse option-like diff bases; name unknown revisions | dashboard | UNVERIFIED |
| T2 | bfafcdcb | Viewer Host admission; remove ACAO:null | dashboard | UNVERIFIED |
| T3 | 75a704b4 | Derive C++ denominator extensions from collector | lsp-trust-spine | UNVERIFIED |
| T4 | 702b54c0 | Refuse unknown extensions instead of choosing clangd | live-code-intel | UNVERIFIED |
| T5 | 16aa04e3 | Shared LSP record helpers and missing-range normalization | live-code-intel | UNVERIFIED |
| T6 | bfe62b49 | Serial host worker and owned LSP lifetime | live-code-intel | UNVERIFIED |
| T7 | d8c946ad | Injectable packet enrichment timeout budget | context-packets | UNVERIFIED |
| T8 | a0d5b131 | One taxonomy owner for CODE_NODE_TYPES | health-and-trust | UNVERIFIED |

The authoring audit read immutable Git parents, bodies and production diffs, then historical parent-session edit/patch and commit events. Commit execution alone is not sole authorship. Some production edits used shell patch scripts rather than Edit/Write tools. The T2 and T7 patch commands were read directly. The metadata parser missed T2's `COMMIT=<sha>` receipt; its actual native record was read instead of treating a parser miss as absent authorship.

Historical event pointers use `event UUID@JSONL line` in session `d8ba8de3-22d0-4a21-b690-2b74722f7e8e.jsonl`. The metadata scan used records before 2026-11-14T06:00:00Z, excluding the audit's own later queries. The private transcript and its unrelated content are not copied into this repository.

Review inspection included targeted commit-prefix and topic searches in the designated grader's recorded sent/received history, the latest 30 inbound headers from a population of 399, and full bodies of relevant returned records. That is a bounded search, not a complete review archive. It does not exclude task-specific review under other wording, in other sessions, or outside the inspected record.

Earlier same-file reviews were checked for their actual scope. The October rehearsal graded `5d152a1a` scoped callers and `dcda0f71` health ratios, not every subsequent edit in those files. September rangeFromLsp advice concerned earlier C++ coherence, not necessarily T5's later helper ownership. Collector budget advice did not establish review of T7's packet call path. The forwarded September resolver review did not mention `apg provide`; a loose search hit had initially been characterized incorrectly, and that characterization was corrected after reading the full body. None of these scope distinctions establishes complete independence for a selected row.

## Conflicts and replacements

Two positive review conflicts were inspected and excluded:

1. `72996bce49b95f530b5d32396558410199efcbfb`. Its commit body explicitly credits grader pre-code review shaping fixed-point expansion. Full review `1790384296417-022901c6` also assessed the merged correction. This is the known-conflict control.
2. `27c5c4224165caae72709269e8134c3f47cf9aed`. It had no grader-name flag. Full review `1790392117036-5d4e369a` assessed the exact-case helper while reviewing descendant `7933c475`. The selected commit is an ancestor of that review target. `mcp/stdio/freshness/path-exists.js` has identical blob `905a6f09f6faf1fb3b17a960f6ef2c8c29fcd684` at both. This is a byte-bound review conflict, not merely the same filename appearing twice.

The initial tentative set also contained `95729a88`, `9fa2bd05` and `1ef73285`. They are not selected in v1. The anchored portion of `95729a88` only changes a comment's documentation citation, so this selection prefers direct code changes with explicit pre-task file anchors. That is a selection choice, not a new global eligibility rule or a proven grader conflict. The other two replacements have no final exclusion verdict here. Replacing all four tentative rows adds T3-T6 and preserves eight candidates.

The population screen at the pinned cutoff observed 232 non-merge commits, 36 anchored files and 15 raw candidates. Fourteen lack a grader-name flag. After the two documented conflicts, at most 13 raw candidates remain; this is an upper bound, not 13 certified eligible tasks. The larger screened pool has five live-code-intel memberships. The cap applies to the selected eight, not to that larger pool.

## Reproduce the structural result

From the APG repository root:

```sh
node docs/evidence/usefulness-trial-2026-10-02/verify-selection.mjs
node docs/evidence/usefulness-trial-2026-10-02/verify-selection-controls.mjs
node docs/evidence/usefulness-trial-2026-10-02/task-population.mjs c3dbb3eb
```

Observed on 2026-11-14: selection verifier exited 0 and printed `SELECTION_STRUCTURE_PASS`. It reported eight selected, zero CLEAR, eligibilityCertified false, dashboard 2, live-code-intel 3, lsp-trust-spine 1, context-packets 1 and health-and-trust 1. Maximum 3. It checks exact single parents, map ancestry, unchanged map blobs, changed explicit file anchors present at each base, derived memberships and exclusion of both known conflicts. Known anchored `d8c946ad` was FOUND; evidence-only `c3dbb3eb` was ABSENT from anchored changes. The population counter reproduced the 232/36/15 screen above.

These checks establish source-level file coverage, not the protocol's live imported-node coverage precondition. No service coverage or trial execution was checked. The verifier cannot turn a manually supplied CLEAR into proof of review independence.

## What would close the eligibility gap

The owner needs task-specific author and review provenance sufficient to establish independence for eight candidates, or must keep the trial on hold. The missing evidence is not repaired by renaming verdicts, repeating a zero-result search, changing grader silently or asking the held grader to inspect the proposed solutions. Any later clearance or replacement needs a new manifest version and recomputed feature counts. Preserve v1 as this audit's result.

No eligible-eight claim follows from this preparation. The existing owner plan records 2026-11-28 as the next re-check if clearance cannot be established. No further implementation remains in this preparation scope.
