TAX_RATE = 0.2


class LineItem:
    def __init__(self, name, price, quantity=1):
        self.name = name
        self.price = price
        self.quantity = quantity

    def subtotal(self):
        return self.price * self.quantity


class Order:
    currency = "EUR"

    def __init__(self, customer):
        self.customer = customer
        self.items = []

    def add(self, item):
        self.items.append(item)
        return self

    def total(self):
        amount = 0
        for item in self.items:
            amount += item.subtotal()
        return apply_tax(amount)


def apply_tax(amount):
    return round(amount * (1 + TAX_RATE), 2)
