<?php

use App\Http\Controllers\UserController;
use App\Http\Controllers\PhotoController;
use App\Http\Controllers\InvokableController;
use App\Http\Controllers\Admin as AdminControllers;
use App\Http\Middleware\Audit;
use Illuminate\Support\Facades\Route;

Route::get('/users/{id}', [UserController::class, 'show']);
Route::get('/fq', [\App\Http\Controllers\UserController::class, 'index'])->name('fq');
Route::get('/legacy', 'LegacyController@index');
Route::post('/d', InvokableController::class);
Route::resource('photos', PhotoController::class)->only(['index', 'show']);
Route::get('/closure', function () {
    return 'hi';
});

Route::controller(UserController::class)->group(function () {
    Route::get('/me', 'profile');
});

Route::middleware([Audit::class])->prefix('admin')->group(function () {
    Route::get('/dash', [AdminControllers\DashboardController::class, 'index']);
    Route::get('/inline', function () {
        return view('x');
    });
    Route::get('/after', [AdminControllers\ReportController::class, 'list']);
});

Route::view('/about', 'about');
Route::match(['get', 'post'], '/search', [UserController::class, 'search']);
