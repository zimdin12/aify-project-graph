// ⛔ THE SECOND COUNTEREXAMPLE. A unity/jumbo build pulls implementation files into ONE
// translation unit, so "which TU is this symbol in" stops being answerable per-file. Even a
// correct internal-linkage judgement about helper.cpp is about a TU that no longer exists
// on its own once this file is what actually gets compiled.
#include "helper.cpp"
#include "caller-via-extern.cpp"
