// Two DIFFERENT symbols that share a name. This is the case grep structurally cannot resolve:
// a text search for `render` returns both, with nothing to say they are not the same thing.
#pragma once

namespace alpha {
class Widget {
 public:
  void render();
};
}  // namespace alpha

namespace beta {
class Widget {
 public:
  void render();
};
}  // namespace beta
