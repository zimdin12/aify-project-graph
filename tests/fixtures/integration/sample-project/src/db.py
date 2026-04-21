def get_user(user_id):
    return query("SELECT * FROM users WHERE id = ?", user_id)

def get_user_profile(user_id):
    user = get_user(user_id)
    return {"id": user["id"], "profile": user}

def find_token(token):
    return query("SELECT * FROM tokens WHERE value = ?", token)

def query(sql, *params):
    pass
