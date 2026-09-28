module Billing
  module Money
    def self.format(cents)
      units = cents / 100
      rest = cents % 100
      "#{units}.#{rest.to_s.rjust(2, '0')} EUR"
    end

    def self.round(amount)
      amount.round
    end
  end
end
