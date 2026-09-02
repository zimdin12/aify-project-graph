#include "lib.h"
namespace demo {
void hiddenCall() {}
void visibleCall() {}
void driver() {
#ifdef FEATURE_X
  hiddenCall();      // NEVER COMPILED: FEATURE_X is not defined by any compile command here
#endif
  visibleCall();     // always compiled — the positive control
}
}
