#include "shapes.h"

// P5 — an internal-linkage helper sharing a spelling with the one in shapes.cpp.
// Two DISTINCT symbols; no external linkage connects them.
static int helper(int x) { return x * 2; }

namespace {
// P5 — anonymous-namespace twin, also internal linkage.
int hidden(int x) { return x - 1; }
}  // namespace

int other_use(int x) { return helper(x) + hidden(x); }

// P6 — the same extern spelling declared a second time, in another impl file.
extern void externally_declared(int flag);
