// Nested namespaces, so scope carriers have MORE THAN ONE segment.
//
// The whole-corpus C++ differential could not exercise segment ORDER before this file existed:
// every carrier in the fixture corpus had exactly one segment, so a mutant that reversed the
// order was a no-op on every single row and survived for a population reason rather than a
// correctness one. Order is load-bearing — `outer::inner::Widget` and `inner::outer::Widget`
// are different symbols — so the corpus has to contain a case that can tell them apart.
namespace outer {
namespace inner {

class Widget {
 public:
  void render();
  void resize();
};

void Widget::render() {}

}  // namespace inner
}  // namespace outer

// A written qualifier with more than one segment, for the same reason.
void outer::inner::Widget::resize() {}
