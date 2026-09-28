<?php

namespace Acme\Invoicer\Money;

final class Money
{
    public function __construct(private int $cents) {}

    public function add(Money $other): self
    {
        return new self($this->cents + $other->cents);
    }

    public function cents(): int
    {
        return $this->cents;
    }
}
