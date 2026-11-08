#pragma once

namespace geo {

class Shape {
public:
    explicit Shape(int sides);
    virtual ~Shape() = default;
    virtual double area() const = 0;
    int sides() const;
    static Shape* unit();

private:
    int sides_;
};

class Square : public Shape {
public:
    explicit Square(double edge);
    double area() const override;

private:
    double edge_;
};

template <typename T>
T twice(T value) { return value + value; }

}  // namespace geo
