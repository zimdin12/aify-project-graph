// Class 5: the DYNAMIC boundary. `dispatchTarget` is never called by name anywhere.
// It is reached through a function pointer held in a registration table, so both a
// header grep AND a compiler-backed reference search over call sites can report zero
// callers while the entity is very much used at runtime.
//
// ⚠ This is the case that must return exhaustive:false NO MATTER how good the linkage
// analysis is. It is the audited-boundary predicate, and no static proof covers it.
static int dispatchTarget(int x) { return x * 3; }

using Handler = int (*)(int);

// The only reference is this table entry — never a call expression.
static Handler kRegistry[] = { dispatchTarget };

int invokeByIndex(int i, int x) { return kRegistry[i](x); }
