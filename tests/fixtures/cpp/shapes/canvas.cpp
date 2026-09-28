#include "canvas.hpp"

void Canvas::add(geo::Shape *shape) {
    shapes_.push_back(shape);
}

double Canvas::totalArea() const {
    double sum = 0;
    for (const geo::Shape *s : shapes_) {
        sum += s->area();
    }
    return sum;
}
