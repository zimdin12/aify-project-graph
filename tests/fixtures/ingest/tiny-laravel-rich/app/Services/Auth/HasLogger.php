<?php

namespace App\Services\Auth;

trait HasLogger
{
    protected function log(string $msg): void
    {
        error_log($msg);
    }
}
