<?php

namespace App\Http\Middleware;

class RequireToken
{
    public function handle($request, $next)
    {
        return $next($request);
    }
}
