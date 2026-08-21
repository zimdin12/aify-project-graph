// A DELIBERATELY WORTHLESS FILE, AND THAT IS ITS ENTIRE VALUE.
//
// ⛔ WHY THIS EXISTS. To prove the per-arm workspace transport works — that a mutation lands in a
// disposable worktree and the main checkout stays byte-identical — something has to actually be
// mutated. The first time I proved it I reached for `route-authority-G8`, a CLOSED scientific arm.
// The referee refused that:
//
//   > G8's prior experiment was closed and its result immutable. Re-running it to prove isolation
//   > does not add scientific evidence. Both participants already knew its mutation and output;
//   > it cannot witness a prediction again.
//
// They are right, and the error is one I would not have seen: re-running a closed experiment feels
// free, but every run of a scientific arm is a sample of something, and a sample nobody
// preregistered contaminates the arm it borrows. A transport check is not an experiment and must
// not be paid for out of an experiment's budget.
//
// ⇒ So this file guards NOTHING. It is not a fixture for any behaviour under study, it carries no
// guarantee, and its test cannot catch a bug because there is no bug it could have. It is a
// mutation TARGET, and re-running it costs nothing because there is nothing here to contaminate.
//
// ⚠ DO NOT IMPORT THIS FROM PRODUCTION CODE, and do not add real logic to it. The moment it means
// something, mutating it starts meaning something too, and the whole point is lost.
export const TRANSPORT_CANARY = 'intact';
