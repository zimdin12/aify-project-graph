<?php

namespace App\Services\Auth;

use App\Models\User;

class TokenService
{
    use HasLogger;

    public function issueFor(User $user): string
    {
        $raw = bin2hex(random_bytes(16));
        $this->log("issued token for {$user->id}");
        return $raw;
    }

    public function revoke(User $user): void
    {
        $user->tokens()->delete();
    }
}
