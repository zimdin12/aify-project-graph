<?php

namespace App\Http;

use App\Http\Middleware\RequireToken;
use App\Http\Middleware\ThrottleNonIntrusive;

class Kernel
{
    protected $middlewareGroups = [
        'allow-end-user' => [
            'require-token',
            'throttle-non-intrusive',
        ],
    ];

    protected $routeMiddleware = [
        'require-token' => RequireToken::class,
        'throttle-non-intrusive' => ThrottleNonIntrusive::class,
    ];
}
