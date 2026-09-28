<?php

namespace Acme\Invoicer\Billing;

abstract class BaseTotals
{
    protected function round(int $cents): int
    {
        return (int) round($cents);
    }
}
