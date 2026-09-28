module Billing
  class LineItem
    attr_reader :description, :amount

    def initialize(description, amount)
      @description = description
      @amount = amount
    end

    def total
      amount
    end
  end
end
