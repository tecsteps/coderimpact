defmodule Shop.Cart do
  alias Shop.Pricing

  defstruct items: []

  def new, do: %Shop.Cart{}

  def add(cart, item) do
    %{cart | items: [item | cart.items]}
  end

  def total(cart) do
    subtotal = sum(cart.items)
    Pricing.with_tax(subtotal)
  end

  defp sum(items) do
    Enum.reduce(items, 0, fn item, acc -> acc + item.price end)
  end
end
