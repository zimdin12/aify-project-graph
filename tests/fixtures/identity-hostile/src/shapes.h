#pragma once
namespace alpha {

// P4 — a class named Widget, in namespace alpha.
class Widget {
 public:
  void render();
  int measure(int width) const;
};

// P3 — free-standing declaration paired with a definition in shapes.cpp.
void configure(int level);

// P1 — two overloads of one spelling, declared in ONE file.
int clamp(int value);
double clamp(double value);

// P7 — a template and an operator.
template <typename T> T identity(T value) { return value; }
bool operator==(const Widget& a, const Widget& b);

}  // namespace alpha

namespace beta {

// P4 — a DIFFERENT class, also named Widget, in namespace beta.
class Widget {
 public:
  void render();
};

}  // namespace beta

// P6 — a repeated extern declaration with no header of its own.
extern void externally_declared(int flag);
