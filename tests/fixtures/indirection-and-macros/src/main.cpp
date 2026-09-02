#include "lib.h"
#define CALL_IT() macroTarget()
namespace demo {
void directTarget() {}
void ptrTarget() {}
void macroTarget() {}
void caller() {
  directTarget();              // CONTROL: a plain call, must be found
  void (*fp)() = &ptrTarget;   // reached only through a pointer
  fp();
  CALL_IT();                   // the call exists only after macro expansion
}
}
