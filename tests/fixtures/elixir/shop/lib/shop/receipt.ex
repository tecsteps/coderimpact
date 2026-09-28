defmodule Shop.Receipt do
  alias Shop.Cart
  alias Shop.Pricing

  def render(cart) do
    lines = Enum.map(cart.items, &line/1)
    total = Cart.total(cart)
    Enum.join(lines, "\n") <> "\nTotal: " <> Pricing.format(total)
  end

  defp line(item), do: item.name <> " " <> Pricing.format(item.price)

  def format(cart), do: render(cart)
end
