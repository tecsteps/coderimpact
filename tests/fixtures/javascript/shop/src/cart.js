import { Product } from "./models/product.js";
import { formatPrice, sumOf } from "./util/money.js";

export class Cart {
  items = [];

  constructor(owner) {
    this.owner = owner;
  }

  add(product, qty = 1) {
    this.items.push({ product, qty });
    return this;
  }

  total() {
    const amounts = this.items.map((item) => item.product.price * item.qty);
    return sumOf(amounts);
  }

  onChange = (listener) => {
    listener(this.total());
  };
}

export const summarize = (cart) => {
  const amount = cart.total();
  return formatPrice(amount);
};

export function total(carts) {
  return sumOf(carts.map((c) => c.total()));
}

export function sample() {
  return new Cart("demo").add(new Product("Tea", 450));
}
