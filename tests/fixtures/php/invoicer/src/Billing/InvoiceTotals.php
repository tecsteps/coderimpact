<?php

namespace Acme\Invoicer\Billing;

use Acme\Invoicer\Money\Money as Cash;
use function Acme\Invoicer\Support\format_money;

final class InvoiceTotals extends BaseTotals
{
    private const TAX_RATE = 19;

    public function __construct(private Cash $zero) {}

    public function net(array $lines): Cash
    {
        $sum = $this->zero;
        foreach ($lines as $line) {
            $sum = $sum->add(new Cash($line['cents']));
        }
        return $sum;
    }

    public function gross(array $lines): int
    {
        $net = $this->net($lines);
        return $this->round($net->cents() * (100 + self::TAX_RATE) / 100);
    }

    public function apply(string $method): mixed
    {
        return $this->{$method}();
    }

    public function label(array $lines): string
    {
        return format_money($this->gross($lines));
    }
}
