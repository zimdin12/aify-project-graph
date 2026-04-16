from src.db import find_token

class User:
    def __init__(self, id, name):
        self.id = id
        self.name = name

def authenticate(token):
    record = find_token(token)
    if not record:
        raise ValueError("invalid token")
    return User(record["id"], record["name"])
