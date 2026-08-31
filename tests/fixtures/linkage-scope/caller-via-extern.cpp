// ⛔ THE COUNTEREXAMPLE. No header is involved anywhere. This TU repeats the declaration
// itself and calls the symbol — so "declared in no header" did not make the reference set
// file-local, and a file-local reading of helper.cpp would MISS this caller entirely.
extern int blockerHelper(int);

int callSite() { return blockerHelper(21); }
