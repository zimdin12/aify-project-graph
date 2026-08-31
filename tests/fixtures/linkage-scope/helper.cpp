// The "no header" case the proposed shortcut would have called exhaustive.
// This symbol is declared in NO header anywhere in this fixture. A header grep finds nothing.
// It nevertheless has EXTERNAL LINKAGE, so any other translation unit may declare and call it.
int blockerHelper(int x) { return x * 2; }

// Contrast: this one genuinely has internal linkage and IS confined to this TU.
static int trulyFileLocal(int x) { return x + 1; }

int usesLocal(int x) { return trulyFileLocal(x); }
