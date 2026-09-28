import { formatPrice } from "./util/money.js";

const Price = ({ value }) => <span className="price">{formatPrice(value)}</span>;

export function CartView({ cart }) {
  const amount = cart.total();
  return (
    <div>
      <Price value={amount} />
    </div>
  );
}
