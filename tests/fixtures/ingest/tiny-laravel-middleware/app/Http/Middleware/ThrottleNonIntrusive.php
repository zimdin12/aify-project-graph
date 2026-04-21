<?php

namespace App\Http\Middleware;

class ThrottleNonIntrusive
{
    public function handle($request, $next)
    {
        return $next($request);
    }
}
