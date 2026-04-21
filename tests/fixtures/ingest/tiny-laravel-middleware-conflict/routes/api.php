<?php

use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

// Route declares inline middleware in the order [require-token, throttle-non-intrusive].
// Kernel's 'allow-end-user' group declares them in the REVERSED order
// [throttle-non-intrusive, require-token]. This route bypasses the group
// entirely — it inlines its own list. Plugin must emit the chain in the
// route-declared order: Route -> RequireToken -> ThrottleNonIntrusive -> Controller.
Route::middleware(['require-token', 'throttle-non-intrusive'])
    ->group(function (): void {
    Route::get('/profile', [ProfileController::class, 'show']);
});
