<?php

namespace App\Billing;

use App\Contracts\Payable;
use App\Support\Money as Cash;
use App\Support\Clock;
use App\Billing\Document as BaseDocument;

interface Totals
{
    public function total(): int;
}

trait Stamps
{
    public function stamp(): string
    {
        return Clock::now();
    }
}

class Invoice extends BaseDocument implements Payable, Totals
{
    use Stamps;

    private Cash $amount;

    public function __construct(int $cents)
    {
        $this->amount = new Cash($cents);
    }

    public function total(): int
    {
        return $this->amount->cents() + static::fee();
    }

    public static function fee(): int
    {
        return Cash::zero()->cents();
    }
}

function issue(int $cents): Invoice
{
    $invoice = new Invoice($cents);
    $invoice->total();
    return $invoice;
}
