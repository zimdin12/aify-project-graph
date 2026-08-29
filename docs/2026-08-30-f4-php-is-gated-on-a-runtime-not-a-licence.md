# F4 is gated on a runtime, not on a licence

2026-08-30. The corpus summary records:

> - **F4 (PHP language server)** is blocked on a licence, not engineering — Steven's call.

That sentence is doing two things wrong at once. It states one gate where there are two, and it puts
the non-negotiable one on the critical path while leaving the tractable one unnamed.

## First: F4 is a capability gap, not a correctness defect

The defect that made PHP urgent — `fast-route` (PHP) reporting **0 verified edges yet trust
"strong"** — was closed by F1. `graph-capabilities` derives `languageHasServer` from the real
registry rather than a hand-written map, so PHP now reports no compiler-verified authority instead of
borrowing confidence it never had. Verified today, with controls in the same call:

    getBackend(python    ) : present
    getBackend(cpp       ) : present
    getBackend(c         ) : present
    getBackend(typescript) : present
    getBackend(php       ) : null

⇒ Nothing false is being said about PHP repositories. What is missing is a capability, and the honest
report of its absence is already shipped. That changes F4's priority: it buys reach, not integrity.

## Second: there are two independent gates, and only one is a licence

| server | implemented in | licence | blocked by |
|---|---|---|---|
| intelephense | Node | proprietary; §5 forbids distribution | **licence** — bundling it is distribution |
| phpactor | PHP | MIT | **no PHP runtime on this host** |
| Psalm LS, Serenata, php-language-server | PHP | OSI | **no PHP runtime on this host** |

Re-verified on this machine today rather than carried forward from the spike:

    php       : NOT FOUND
    php8      : NOT FOUND
    composer  : NOT FOUND
    phpactor  : absent

The spike was right that bundling intelephense is a licence question and not ours to decide around.
But it treated the missing PHP runtime as merely *eliminating* the open-source servers, and there the
framing hardened into "blocked on a licence".

⇒ **A licence cannot be negotiated. A runtime can be installed.** The moment a PHP runtime exists on
the host, `phpactor` is MIT-licensed, bundles nothing, runs under the same detect-or-guide model this
repo already uses for clangd — and **F4 stops involving a licence question entirely.** It becomes
ordinary engineering that can be tested end to end, which is what the spike said it could not be.

## What this changes about the decision waiting on Steven

The question on the table was "do we accept intelephense's licence interpretation?" — a legal
judgement with an untestable outcome, since the repo's own rule forbids shipping a path that cannot
be verified.

The question that should be on the table is "should this machine have a PHP runtime?" — an install
decision with a testable outcome. It removes the licence from the critical path, uses an MIT server,
and lets the working path be measured before it ships.

⚠ **I did not install one.** Adding a language runtime is a change to Steven's machine rather than to
this repository, and it is a one-line question rather than something to do quietly. The engineering
after it is small: `backends.js` needs one entry and one `.php` extension mapping, and `nodeLspSpawn`
already falls through to PATH, which the spike verified.

## The correction worth keeping

⛔ **"Blocked on X" deserves the same scrutiny as "caused by X".** Both are single-cause claims, and
this one hid a second cause that was easier to remove than the one it named. The tell was that the
recorded blocker was the *unfixable* one — when a summary names the immovable gate and omits the
movable gate beside it, the work stops for the wrong reason.
