#include "shape.hpp"

namespace geo {

static const double kPi = 3.14159265358979;

static double clamp_radius(double r) {
    return r < 0 ? 0 : r;
}

Circle::Circle(double radius) : Shape("circle"), radius_(clamp_radius(radius)) {}

double Circle::area() const {
    return kPi * radius_ * radius_;
}

void Circle::scale(double factor) {
    double next = radius_ * factor;
    radius_ = clamp_radius(next);
}

Circle make_unit_circle() {
    return Circle(1.0);
}

}  // namespace geo
