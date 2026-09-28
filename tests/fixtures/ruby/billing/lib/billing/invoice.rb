module Billing
  class Invoice
    attr_reader :lines

    def initialize(customer)
      @customer = customer
      @lines = []
    end

    def add_line(description, cents)
      lines << LineItem.new(description, cents)
      self
    end

    def total
      sum = 0
      lines.each { |line| sum += line.amount }
      Money.round(sum)
    end

    def to_s
      header + "\n" + Money.format(total)
    end

    private

    def header
      "Invoice for #{@customer}"
    end
  end
end
