#pragma once

#include <vector>
#include "shape.hpp"

class Canvas {
public:
    void add(geo::Shape *shape);
    double totalArea() const;
    int count() const { return static_cast<int>(shapes_.size()); }

private:
    std::vector<geo::Shape *> shapes_;
};
