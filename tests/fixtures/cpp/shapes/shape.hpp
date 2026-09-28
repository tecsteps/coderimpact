#pragma once

#include <string>

namespace geo {

class Shape {
public:
    explicit Shape(std::string name) : name_(std::move(name)) {}
    virtual ~Shape() = default;
    virtual double area() const = 0;
    const std::string &name() const { return name_; }

private:
    std::string name_;
};

class Circle : public Shape {
public:
    Circle(double radius);
    double area() const override;
    void scale(double factor);

private:
    double radius_;
};

class Rect : public Shape {
public:
    Rect(double w, double h) : Shape("rect"), w_(w), h_(h) {}
    double area() const override { return w_ * h_; }
    double perimeter() const { return 2 * (w_ + h_); }

private:
    double w_;
    double h_;
};

Circle make_unit_circle();

}  // namespace geo
