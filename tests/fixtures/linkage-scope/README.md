# Predicted-failure fixtures for the "no header ⇒ exhaustive" shortcut

A field report proposed a cheap exhaustiveness proof: if a symbol is **declared in no header**, a
file-local reading of its defining `.cpp` is complete, so you can answer "does anything else use
this?" without the resolver. It worked on the case that produced it, and it is **not sound**.

These fixtures exist so no implementation of that rule can graduate without meeting them first.

## What they falsify

`blockerHelper` is declared in **zero** headers — a header grep returns nothing — and still has
**external linkage**, so any other translation unit may declare and call it:

| file | role |
|---|---|
| `helper.cpp` | defines `blockerHelper` (external linkage, no header anywhere) and `trulyFileLocal` (`static`, genuinely TU-confined) |
| `caller-via-extern.cpp` | repeats the declaration itself with `extern` and calls it — a caller a file-local reading MISSES |
| `unity-build.cpp` | `#include`s both `.cpp` files, so "which TU is this symbol in" stops being answerable per file |

Measured on these bytes: 0 header declarations, 2 `.cpp` files referencing the symbol.

## Why the shortcut fails, in general

The sound noun is **translation-unit / internal-linkage scope**, never file-locality. Ordinary C++
breaks the file-local reading in at least five ways: a repeated `extern` in another `.cpp`;
unity/jumbo builds; one source `#include`-ing another `.cpp` or `.inc`; macros and token-pasting
creating declarations no literal-name grep finds; and aliases, registration tables, function
pointers or runtime lookup using the entity without the expected spelling.

## What a real proof would require

All four, together — any one missing means `candidate_internal_scope` / `exhaustive:false`, never a
proof:

1. the compiler/AST proves internal or no external linkage (`static`, unnamed namespace, local
   entity) — **not** that a grep found no header;
2. the exact compile-command/TU population is known, including unity sources and included
   implementation fragments;
3. the defining TU compiled successfully and compiler-backed references covered it;
4. no audited dynamic, linker or string boundary applies.

Only then may the claim read "exhaustive **within this compiler-proven linkage/TU scope**" — a
scoped claim, not an unqualified one.

## Why this is written down rather than remembered

This repository has repeatedly shipped a *sometimes*-proof and discovered later that the sometimes
was doing all the work. The generation-publication unit immediately before this one existed to
remove exactly that shape. A cheap check that is right on the case that motivated it is the most
expensive kind of wrong, because nothing prompts anyone to test it again.

`trulyFileLocal` is the positive control: a rule that cannot distinguish it from `blockerHelper` is
not measuring linkage at all.
