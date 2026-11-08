#include "shape.h"

double report(const geo::Shape& shape) {
    return shape.area() + shape.sides();
}

int main() {
    geo::Square square(3.0);
    geo::Shape* unit = geo::Shape::unit();
    return static_cast<int>(report(square) + report(*unit));
}
