<?php

// Looks like a Laravel route file, but this repository has no Laravel (no composer.json requiring
// laravel/framework). The Laravel plugin must not invent Route nodes from it.
Route::get('/invoices', [InvoiceController::class, 'index']);
