defmodule Shop.CLI do
  alias Shop.Cart
  alias Shop.Receipt

  def main(_args) do
    cart =
      Cart.new()
      |> Cart.add(%{name: "Book", price: 12.5})
      |> Cart.add(%{name: "Pen", price: 1.5})

    IO.puts(Receipt.render(cart))
    IO.puts(Shop.Pricing.format(Cart.total(cart)))
  end
end
