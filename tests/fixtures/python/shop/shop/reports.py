from shop.models import Order, LineItem
from shop.formatting import describe
from shop.validation import validate


def total(orders):
    return sum(order.total() for order in orders)


class Report:
    def __init__(self, orders):
        self.orders = orders

    def build(self):
        valid = [order for order in self.orders if validate(order)]
        summary = total(valid)
        text = self.render(valid)
        return text, summary

    def render(self, orders):
        return "\n\n".join(describe(order) for order in orders)


def main():
    order = Order("Ada")
    order.add(LineItem("Book", 12.5, 2)).add(LineItem("Pen", 1.5))
    report = Report([order])
    print(report.build())
