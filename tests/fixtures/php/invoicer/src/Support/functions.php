<?php

namespace Acme\Invoicer\Support;

function format_money(int $cents): string
{
    return number_format($cents / 100, 2);
}
