<?php

use App\Http\Controllers\ProfileController;
use Illuminate\Support\Facades\Route;

Route::middleware(['allow-end-user'])
    ->group(function (): void {
    Route::get('/profile', [ProfileController::class, 'show']);
});
