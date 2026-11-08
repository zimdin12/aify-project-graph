#include "shape.h"

namespace geo {

Shape::Shape(int sides) : sides_(sides) {}

int Shape::sides() const { return sides_; }

Shape* Shape::unit() { return new Square(1.0); }

Square::Square(double edge) : Shape(4), edge_(edge) {}

double Square::area() const { return twice(edge_) * edge_ / 2.0; }

}  // namespace geo
