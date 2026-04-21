<?php

namespace App\Http;

use App\Http\Middleware\RequireToken;
use App\Http\Middleware\ThrottleNonIntrusive;

class Kernel
{
    // Group declares [throttle-non-intrusive, require-token] — "throttle first".
    // The conflict route below declares [require-token, throttle-non-intrusive]
    // inline (reversed). Plugin must honor the route's inline order, not the
    // Kernel group order, for inline (non-group-reference) middleware lists.
    protected $middlewareGroups = [
        'allow-end-user' => [
            'throttle-non-intrusive',
            'require-token',
        ],
    ];

    protected $routeMiddleware = [
        'require-token' => RequireToken::class,
        'throttle-non-intrusive' => ThrottleNonIntrusive::class,
    ];
}
