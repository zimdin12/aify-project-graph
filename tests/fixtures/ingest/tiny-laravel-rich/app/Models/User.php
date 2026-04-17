<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

#[\AllowDynamicProperties]
class User extends Model
{
    protected $fillable = ['email', 'name'];

    public function tokens()
    {
        return $this->hasMany(Token::class);
    }

    public static function findOrFail(int $id): self
    {
        return static::query()->findOrFail($id);
    }
}
