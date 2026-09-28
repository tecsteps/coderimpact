require_relative "helpers"
require_relative "billing/invoice"

def print_invoice(invoice)
  puts banner("Invoice")
  puts invoice.to_s
  puts format("Lines: #{invoice.lines.size}")
end

def build_sample
  invoice = Billing::Invoice.new("Ada")
  invoice.add_line("Book", 1250).add_line("Pen", 150)
  invoice
end

print_invoice(build_sample)
puts build_sample.total
