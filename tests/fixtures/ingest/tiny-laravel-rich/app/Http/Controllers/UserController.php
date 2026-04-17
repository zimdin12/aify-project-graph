<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Services\Auth\TokenService;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;

class UserController extends BaseController
{
    public function __construct(private TokenService $tokens)
    {
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $user = User::findOrFail($id);
        $token = $this->tokens->issueFor($user);
        return response()->json([
            'user' => $user,
            'token' => $token,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => 'required|email',
            'name' => 'required|string|max:100',
        ]);
        $user = User::create($data);
        return response()->json($user, 201);
    }
}
