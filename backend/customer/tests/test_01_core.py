# ApnaDairy B2C — worker 1 tests: JWT validation + auth deps.
#
# JWT tests use a locally-generated RSA keypair and a mocked JWKS fetch
# (no network). deps tests patch app.core.deps.get_mobile_client and
# app.core.deps.validate_supabase_jwt.
import time
import uuid
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from starlette.requests import Request

from app.core import deps
from app.core import security

MOBILE_URL = "https://test-mobile.supabase.co"
ISSUER = f"{MOBILE_URL}/auth/v1"
KID = "test-kid-1"
SUB = str(uuid.uuid4())
CUSTOMER_ID = str(uuid.uuid4())


def _keypair():
    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return priv, pem


_PRIV, _PRIV_PEM = _keypair()
_OTHER_PRIV, _OTHER_PRIV_PEM = _keypair()


def _sign(payload: dict, pem: bytes = _PRIV_PEM) -> str:
    return jwt.encode(payload, pem, algorithm="RS256", headers={"kid": KID})


def _payload(**overrides) -> dict:
    now = int(time.time())
    base = {
        "sub": SUB,
        "aud": "authenticated",
        "iss": ISSUER,
        "iat": now,
        "exp": now + 3600,
    }
    base.update(overrides)
    return base


def _mock_jwks(monkeypatch):
    """Point the JWKS fetch at the test keypair (kid -> (pubkey, alg))."""
    keys = {KID: (_PRIV.public_key(), "RS256")}
    monkeypatch.setattr(
        security, "_fetch_jwks_uncached", lambda: keys
    )


def _req(headers: dict) -> Request:
    raw = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "headers": raw})


class _FakeClient:
    """Mimics the supabase-py table().select().eq().limit().execute() chain."""

    def __init__(self, rows):
        self.rows = rows
        self.calls = {}

    def table(self, name):
        self.calls["table"] = name
        return self

    def select(self, cols):
        self.calls["select"] = cols
        return self

    def eq(self, col, val):
        self.calls.setdefault("eq", {})[col] = val
        return self

    def limit(self, n):
        self.calls["limit"] = n
        return self

    def execute(self):
        return SimpleNamespace(data=self.rows)


def _mock_customer_deps(monkeypatch, rows, sub=SUB):
    """Patch deps' validate + mobile client; returns the fake client."""
    monkeypatch.setattr(
        deps, "validate_supabase_jwt", lambda token: {"sub": sub}
    )
    fake = _FakeClient(rows)
    monkeypatch.setattr(deps, "get_mobile_client", lambda: fake)
    return fake


# ---------------------------------------------------------------- JWT -------


def test_jwt_valid_returns_claims(monkeypatch):
    _mock_jwks(monkeypatch)
    claims = security.validate_supabase_jwt(_sign(_payload()))
    assert claims["sub"] == SUB
    assert claims["aud"] == "authenticated"
    assert claims["iss"] == ISSUER


def test_jwt_expired_is_401(monkeypatch):
    _mock_jwks(monkeypatch)
    # Expired well beyond the 30s clock-skew leeway -> must 401.
    token = _sign(_payload(exp=int(time.time()) - 120))
    with pytest.raises(HTTPException) as exc:
        security.validate_supabase_jwt(token)
    assert exc.value.status_code == 401


def test_jwt_wrong_signature_is_401(monkeypatch):
    _mock_jwks(monkeypatch)
    token = _sign(_payload(), pem=_OTHER_PRIV_PEM)  # signed by other key
    with pytest.raises(HTTPException) as exc:
        security.validate_supabase_jwt(token)
    assert exc.value.status_code == 401


def test_jwt_jwks_down_is_503(monkeypatch):
    def _down():
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(security, "_fetch_jwks_uncached", _down)
    with pytest.raises(HTTPException) as exc:
        security.validate_supabase_jwt(_sign(_payload()))
    assert exc.value.status_code == 503


def test_jwt_missing_mobile_url_is_503(monkeypatch):
    _mock_jwks(monkeypatch)
    monkeypatch.delenv("SUPABASE_MOBILE_URL", raising=False)
    with pytest.raises(HTTPException) as exc:
        security.validate_supabase_jwt(_sign(_payload()))
    assert exc.value.status_code == 503


def test_jwt_garbage_token_is_401(monkeypatch):
    _mock_jwks(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        security.validate_supabase_jwt("not-a-jwt")
    assert exc.value.status_code == 401


# ------------------------------------------------- get_current_customer ------


def test_customer_demo_fallback_on(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "true")
    monkeypatch.setenv("DEMO_CUSTOMER_ID", "demo-cust-1")
    called = {"validate": False}

    def _must_not_validate(token):
        called["validate"] = True
        return {"sub": SUB}

    monkeypatch.setattr(deps, "validate_supabase_jwt", _must_not_validate)
    assert deps.get_current_customer(_req({})) == "demo-cust-1"
    assert called["validate"] is False


def test_customer_demo_defaults_off_when_unset(monkeypatch):
    # Production-safe default: no valid JWT and env unset -> 401, never the
    # demo fallback.
    monkeypatch.delenv("AUTH_DEMO_ENABLED", raising=False)
    with pytest.raises(HTTPException) as ei:
        deps.get_current_customer(_req({}))
    assert ei.value.status_code == 401


def test_customer_missing_auth_header_is_401(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "false")
    with pytest.raises(HTTPException) as exc:
        deps.get_current_customer(_req({}))
    assert exc.value.status_code == 401


def test_customer_malformed_auth_header_is_401(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "false")
    with pytest.raises(HTTPException) as exc:
        deps.get_current_customer(_req({"Authorization": "Token abc123"}))
    assert exc.value.status_code == 401


def test_customer_invalid_token_is_401(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "false")

    def _bad(token):
        raise HTTPException(status_code=401, detail="Invalid login token.")

    monkeypatch.setattr(deps, "validate_supabase_jwt", _bad)
    with pytest.raises(HTTPException) as exc:
        deps.get_current_customer(_req({"Authorization": "Bearer bad.token.here"}))
    assert exc.value.status_code == 401


def test_customer_no_profile_is_403(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "false")
    _mock_customer_deps(monkeypatch, rows=[])
    with pytest.raises(HTTPException) as exc:
        deps.get_current_customer(_req({"Authorization": "Bearer good.token"}))
    assert exc.value.status_code == 403


def test_customer_found_returns_id(monkeypatch):
    monkeypatch.setenv("AUTH_DEMO_ENABLED", "false")
    fake = _mock_customer_deps(monkeypatch, rows=[{"id": CUSTOMER_ID}])
    got = deps.get_current_customer(_req({"Authorization": "Bearer good.token"}))
    assert got == CUSTOMER_ID
    assert fake.calls["table"] == "customer_profiles"
    assert fake.calls["eq"] == {"auth_user_id": SUB}


# -------------------------------------------------------- require_staff ------


def test_require_staff_ok(monkeypatch):
    monkeypatch.setenv("STAFF_API_KEY", "test-staff-key")
    assert deps.require_staff(_req({"X-Staff-Key": "test-staff-key"})) is True


def test_require_staff_missing_key_is_401(monkeypatch):
    monkeypatch.setenv("STAFF_API_KEY", "test-staff-key")
    with pytest.raises(HTTPException) as exc:
        deps.require_staff(_req({}))
    assert exc.value.status_code == 401


def test_require_staff_wrong_key_is_403(monkeypatch):
    monkeypatch.setenv("STAFF_API_KEY", "test-staff-key")
    with pytest.raises(HTTPException) as exc:
        deps.require_staff(_req({"X-Staff-Key": "wrong"}))
    assert exc.value.status_code == 403


def test_require_staff_unconfigured_is_503(monkeypatch):
    monkeypatch.delenv("STAFF_API_KEY", raising=False)
    with pytest.raises(HTTPException) as exc:
        deps.require_staff(_req({"X-Staff-Key": "test-staff-key"}))
    assert exc.value.status_code == 503
