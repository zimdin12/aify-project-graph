#include "widgets.h"

// One caller per namespace, structurally distinct so neither can stand in for the other.
// If a query for alpha's render returns betaCaller, two different symbols have been merged.
void alphaCaller() {
  alpha::Widget w;
  w.render();
}

void betaCaller() {
  beta::Widget w;
  w.render();
}
