def format_price(value):
    return f"{value:.2f} EUR"


def describe(order):
    lines = [describe_item(item) for item in order.items]
    total = order.total()
    lines.append("Total: " + format_price(total))
    return "\n".join(lines)


def describe_item(item):
    return item.name + " " + format_price(item.subtotal())
