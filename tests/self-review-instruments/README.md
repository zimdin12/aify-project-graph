# Instruments, not experiments

Specs in this directory are **not part of the witness corpus** and must never be counted as one.

`tests/self-review/` holds arms under study. Its population is derived PHYSICALLY, by listing that
directory — so anything dropped in there becomes a witness arm whether or not that was intended.
When the transport spec briefly lived there the migration ledger went from 35 arms to 36, and a
pure instrument would have been counted as evidence of a guarantee.

⇒ The separation is a DIRECTORY, not an exclusion list. A list of exempt filenames is a list
somebody must remember to update, which is a defect with a delay on it: the next instrument gets
added, the list does not, and it silently joins the corpus. A path cannot be forgotten.

## What lives here

- `transport-only.spec.json` — mutates a worthless canary to observe that the per-arm workspace
  transport works: the mutation lands in a disposable worktree and the main checkout stays
  byte-identical. It witnesses no guarantee and promotes nothing.

## The rule that created this directory

The first isolation proof re-ran `route-authority-G8`, a CLOSED scientific arm. `graph-senior-dev`
refused it: a closed experiment cannot witness a prediction twice, and re-running one spends a
sample nobody preregistered. Transport checks are not experiments and must not be paid for out of
an experiment's budget.

Run one:

    node scripts/self-review.mjs tests/self-review-instruments/transport-only.spec.json
