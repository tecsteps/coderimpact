import { Cart, summarize, total } from "./cart.js";
import { Product } from "./models/product.js";
import { slugify } from "./util/money.js";

function main() {
  const cart = new Cart("fabian");
  const tea = new Product("Tea", 450);
  cart.add(tea, 2);
  cart.add(tea.withDiscount(10));
  console.log(summarize(cart));
  console.log(cart.total(), total([cart]));
  console.log(slugify(tea.label()));
  return cart;
}

main();
