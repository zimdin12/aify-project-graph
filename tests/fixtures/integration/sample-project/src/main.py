from src.auth import authenticate
from src.db import get_user

def handle_request(request):
    user = authenticate(request.token)
    data = get_user(user.id)
    return format_response(data)

def format_response(data):
    return {"status": "ok", "data": data}
