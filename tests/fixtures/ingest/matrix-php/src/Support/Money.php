<?php

namespace App\Support;

class Money
{
    public string $currency = 'EUR';

    public function __construct(private int $value) {}

    public function cents(): int
    {
        return $this->value;
    }

    public function currency(): string
    {
        return strtoupper($this->currency);
    }

    public static function zero(): Money
    {
        return new Money(0);
    }
}
