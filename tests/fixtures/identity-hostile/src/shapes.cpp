#include "shapes.h"

namespace alpha {

// P3 — definition of the method declared in shapes.h.
void Widget::render() {}

int Widget::measure(int width) const { return width; }

// P2 — definition of the free function declared in shapes.h.
void configure(int level) { (void)level; }

// P1 — definitions of both overloads.
int clamp(int value) { return value; }
double clamp(double value) { return value; }

bool operator==(const Widget& a, const Widget& b) { (void)a; (void)b; return true; }

}  // namespace alpha

namespace beta {

// P4 — the beta Widget's render, distinct from alpha's.
void Widget::render() {}

}  // namespace beta

// P5 — an internal-linkage helper. A DIFFERENT symbol from the one in other.cpp.
static int helper(int x) { return x + 1; }

int use_helper(int x) { return helper(x); }
