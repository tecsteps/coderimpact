def validate(order):
    return len(order.items) > 0 and all(item.price >= 0 for item in order.items)
