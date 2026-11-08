<?php

namespace App\Support;

class Money
{
    public function __construct(private int $value) {}

    public function cents(): int
    {
        return $this->value;
    }

    public static function zero(): Money
    {
        return new Money(0);
    }
}
