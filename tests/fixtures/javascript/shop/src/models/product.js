import { formatPrice } from "../util/money.js";

/** A product in the catalog. */
export class Product {
  constructor(name, price) {
    this.name = name;
    this.price = price;
  }

  withDiscount(percent) {
    const factor = 1 - percent / 100;
    return new Product(this.name, Math.round(this.price * factor));
  }

  label() {
    return `${this.name} (${formatPrice(this.price)})`;
  }
}
