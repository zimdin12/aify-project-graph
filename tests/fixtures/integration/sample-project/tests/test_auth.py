from src.auth import authenticate

def test_authenticate_valid():
    user = authenticate("valid-token")
    assert user.name == "test"

def test_authenticate_invalid():
    try:
        authenticate("bad-token")
    except ValueError:
        pass
