#include <iostream>
#include "canvas.hpp"

static int count(int shown, int hidden) {
    return shown + hidden;
}

int main() {
    geo::Circle c = geo::make_unit_circle();
    c.scale(2.0);
    geo::Rect r(3.0, 4.0);
    geo::Rect *rp = &r;
    double p = rp->perimeter();
    Canvas canvas;
    canvas.add(&c);
    canvas.add(rp);
    std::cout << canvas.totalArea() << " " << p << " " << canvas.count() << std::endl;
    return count(canvas.count(), 0) > 0 ? 0 : 1;
}
