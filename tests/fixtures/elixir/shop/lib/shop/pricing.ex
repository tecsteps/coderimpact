defmodule Shop.Pricing do
  @rate 0.2

  def with_tax(amount) do
    amount
    |> discount(:none)
    |> Kernel.*(1 + @rate)
    |> round_price()
  end

  def discount(amount, :none), do: amount
  def discount(amount, :half), do: amount / 2

  def round_price(amount) when is_number(amount), do: Float.round(amount, 2)

  def format(amount) do
    "#{round_price(amount)} EUR"
  end
end
