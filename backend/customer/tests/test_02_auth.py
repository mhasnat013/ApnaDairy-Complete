"""Tests for the auth module (worker 2).

Supabase is never hit: get_mobile_client is patched inside
app.services.auth_service, and validate_supabase_jwt is patched in the same
namespace for the /auth/me tests.
"""
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.main import app
from app.services import auth_service

client = TestClient(app)

_SIGNUP_BODY = {
    "email": "test.user@example.com",
    "password": "supersecret1",
    "first_name": "Test",
    "last_name": "User",
    "phone": "03001234567",
    "role": "customer",
}

_PROFILE_ROW = {
    "id": "cust-1",
    "auth_user_id": "u1",
    "email": "test.user@example.com",
    "first_name": "Test",
    "last_name": "User",
    "phone": "03001234567",
    "role": "customer",
    "verification_status": "pending",
    "area_manager_id": None,
}


def _make_mobile():
    """Mobile client mock: table() self-chains to execute(); auth is a mock."""
    mobile = MagicMock()
    table = MagicMock()
    mobile.table.return_value = table
    table.select.return_value = table
    table.eq.return_value = table
    table.limit.return_value = table
    table.insert.return_value = table
    table.execute.return_value = MagicMock(data=[])
    mobile.auth = MagicMock()
    return mobile, table


def _patch_mobile(mobile):
    # Both the cached service client and the throwaway anon client resolve
    # to the same mock: auth calls (login/OTP/reset) go through the anon
    # client in production code.
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(
        patch.object(auth_service, "get_mobile_client", return_value=mobile)
    )
    stack.enter_context(
        patch.object(auth_service, "get_mobile_anon_client", return_value=mobile)
    )
    return stack


def _user_result(user_id):
    res = MagicMock()
    user = MagicMock()
    user.id = user_id
    user.email = "test.user@example.com"
    res.user = user
    return res


# ---------------- signup ----------------


def test_signup_success_legacy_preconfirmed(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "false")
    mobile, table = _make_mobile()
    mobile.auth.admin.create_user.return_value = _user_result("new-uid")
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=_SIGNUP_BODY)
    assert r.status_code == 200
    body = r.json()
    assert body == {
        "user_id": "new-uid",
        "email": "test.user@example.com",
        "role": "customer",
        "verification_status": "pending",
    }
    mobile.auth.admin.create_user.assert_called_once()
    call_kwargs = mobile.auth.admin.create_user.call_args.args[0]
    assert call_kwargs["email_confirm"] is True
    assert call_kwargs["user_metadata"]["role"] == "customer"
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["auth_user_id"] == "new-uid"
    assert inserted["verification_status"] == "pending"


def test_signup_duplicate_email_422(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "false")
    mobile, _ = _make_mobile()
    mobile.auth.admin.create_user.side_effect = Exception(
        "User already registered"
    )
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=_SIGNUP_BODY)
    assert r.status_code == 422
    assert r.json() == {"detail": "Email already registered."}


def test_signup_generic_auth_error_422(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "false")
    mobile, _ = _make_mobile()
    mobile.auth.admin.create_user.side_effect = Exception("boom")
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=_SIGNUP_BODY)
    assert r.status_code == 422


def test_signup_invalid_role_rejected():
    mobile, _ = _make_mobile()
    body = dict(_SIGNUP_BODY, role="admin")
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=body)
    assert r.status_code == 422
    mobile.auth.admin.create_user.assert_not_called()


def test_signup_farmer_role_ok(monkeypatch):
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "false")
    mobile, _ = _make_mobile()
    mobile.auth.admin.create_user.return_value = _user_result("new-uid-2")
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/signup", json=dict(_SIGNUP_BODY, role="farmer")
        )
    assert r.status_code == 200
    assert r.json()["role"] == "farmer"


# ---------------- real email verification (default path) ----------------


def _signup_result(user_id, identities=None):
    res = MagicMock()
    user = MagicMock()
    user.id = user_id
    user.email = "test.user@example.com"
    user.identities = identities if identities is not None else [{"id": "ident-1"}]
    res.user = user
    return res


def test_signup_sends_verification_email():
    """Default path: real Supabase email OTP, NO tokens, NO profile row yet."""
    mobile, table = _make_mobile()
    mobile.auth.sign_up.return_value = _signup_result("new-uid")
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=_SIGNUP_BODY)
    assert r.status_code == 200
    assert r.json() == {
        "user_id": "new-uid",
        "email": "test.user@example.com",
        "verification_required": True,
    }
    mobile.auth.sign_up.assert_called_once()
    mobile.auth.admin.create_user.assert_not_called()
    table.insert.assert_not_called()


def test_signup_duplicate_empty_identities_422():
    """GoTrue returns empty identities for an already-registered email."""
    mobile, _ = _make_mobile()
    mobile.auth.sign_up.return_value = _signup_result("new-uid", identities=[])
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/signup", json=_SIGNUP_BODY)
    assert r.status_code == 422
    assert r.json() == {"detail": "Email already registered."}


def _verify_result(user_id, with_session=True, metadata=None):
    res = MagicMock()
    user = MagicMock()
    user.id = user_id
    user.email = "test.user@example.com"
    user.user_metadata = metadata or {
        "first_name": "Test",
        "last_name": "User",
        "phone": "03001234567",
        "role": "customer",
    }
    res.user = user
    if with_session:
        session = MagicMock()
        session.access_token = "access-123"
        session.refresh_token = "refresh-123"
        res.session = session
    else:
        res.session = None
    return res


def test_verify_email_success_creates_profile_and_tokens():
    mobile, table = _make_mobile()
    mobile.auth.verify_otp.return_value = _verify_result("new-uid")
    table.execute.return_value = MagicMock(data=[])  # no profile yet
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/verify-email",
            json={"email": "test.user@example.com", "token": "123456"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] == "access-123"
    assert body["refresh_token"] == "refresh-123"
    assert body["user_id"] == "new-uid"
    assert body["verified"] is True
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["id"] == "new-uid"
    assert inserted["auth_user_id"] == "new-uid"
    assert inserted["role"] == "customer"


def test_verify_email_idempotent_no_duplicate_profile():
    mobile, table = _make_mobile()
    mobile.auth.verify_otp.return_value = _verify_result("new-uid")
    table.execute.return_value = MagicMock(data=[_PROFILE_ROW])  # exists
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/verify-email",
            json={"email": "test.user@example.com", "token": "123456"},
        )
    assert r.status_code == 200
    table.insert.assert_not_called()


def test_verify_email_bad_token_422():
    mobile, _ = _make_mobile()
    mobile.auth.verify_otp.side_effect = Exception("Token has expired")
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/verify-email",
            json={"email": "test.user@example.com", "token": "000000"},
        )
    assert r.status_code == 422


def test_resend_verification_always_200():
    mobile, _ = _make_mobile()
    mobile.auth.resend.side_effect = Exception("rate limited")
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/resend-verification",
            json={"email": "nobody@example.com"},
        )
    assert r.status_code == 200
    assert r.json() == {"sent": True}


# ---------------- /auth/me ----------------


def _me(mobile, headers, validate_side_effect=None, validate_return=None):
    with _patch_mobile(mobile), patch.object(
        auth_service, "validate_supabase_jwt"
    ) as validator:
        if validate_side_effect is not None:
            validator.side_effect = validate_side_effect
        else:
            validator.return_value = validate_return or {"sub": "u1"}
        return client.post("/api/v1/auth/me", headers=headers)


def test_me_ok():
    mobile, table = _make_mobile()
    table.execute.return_value = MagicMock(data=[_PROFILE_ROW])
    r = _me(mobile, {"Authorization": "Bearer good-token"})
    assert r.status_code == 200
    assert r.json() == {
        "user_id": "u1",
        "customer_id": "cust-1",
        "email": "test.user@example.com",
        "first_name": "Test",
        "last_name": "User",
        "phone": "03001234567",
        "role": "customer",
        "verification_status": "pending",
        "area_manager_id": None,
    }


def test_me_profile_not_found_404():
    mobile, _ = _make_mobile()
    r = _me(mobile, {"Authorization": "Bearer good-token"})
    assert r.status_code == 404
    assert r.json() == {"detail": "Profile not found."}


def test_me_bad_token_401():
    mobile, _ = _make_mobile()
    r = _me(
        mobile,
        {"Authorization": "Bearer bad-token"},
        validate_side_effect=HTTPException(status_code=401, detail="bad"),
    )
    assert r.status_code == 401


def test_me_missing_header_401():
    mobile, _ = _make_mobile()
    r = _me(mobile, {})
    assert r.status_code == 401


def test_me_malformed_header_401():
    mobile, _ = _make_mobile()
    r = _me(mobile, {"Authorization": "Token abc"})
    assert r.status_code == 401


# ---------------- OTP ----------------


def test_otp_send_ok():
    mobile, _ = _make_mobile()
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/otp/send", json={"phone": "03001234567"})
    assert r.status_code == 200
    assert r.json() == {"sent": True}
    mobile.auth.sign_in_with_otp.assert_called_once_with(
        {"phone": "03001234567"}
    )


def test_otp_send_failure_422():
    mobile, _ = _make_mobile()
    mobile.auth.sign_in_with_otp.side_effect = Exception("rate limited")
    with _patch_mobile(mobile):
        r = client.post("/api/v1/auth/otp/send", json={"phone": "03001234567"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_otp_verify_ok_creates_minimal_profile():
    mobile, table = _make_mobile()
    mobile.auth.verify_otp.return_value = _user_result("otp-uid")
    # First execute() = profile lookup (empty), second = insert result.
    table.execute.side_effect = [
        MagicMock(data=[]),
        MagicMock(data=[{"id": "cust-otp", "auth_user_id": "otp-uid"}]),
    ]
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": "03001234567", "token": "123456"},
        )
    assert r.status_code == 200
    assert r.json() == {"user_id": "otp-uid", "verified": True}
    mobile.auth.verify_otp.assert_called_once_with(
        {"phone": "03001234567", "token": "123456", "type": "sms"}
    )
    table.insert.assert_called_once()
    inserted = table.insert.call_args.args[0]
    assert inserted["auth_user_id"] == "otp-uid"
    assert inserted["phone"] == "03001234567"
    assert inserted["role"] == "customer"
    assert inserted["verification_status"] == "pending"


def test_otp_verify_ok_existing_profile_no_insert():
    mobile, table = _make_mobile()
    mobile.auth.verify_otp.return_value = _user_result("u1")
    table.execute.return_value = MagicMock(data=[_PROFILE_ROW])
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": "03001234567", "token": "123456"},
        )
    assert r.status_code == 200
    assert r.json() == {"user_id": "u1", "verified": True}
    table.insert.assert_not_called()


def test_otp_verify_failure_422():
    mobile, _ = _make_mobile()
    mobile.auth.verify_otp.side_effect = Exception("bad otp")
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/otp/verify",
            json={"phone": "03001234567", "token": "000000"},
        )
    assert r.status_code == 422
    assert r.json() == {"detail": "Invalid or expired OTP."}


# ---------------- login / forgot-password / logout ----------------


def _session_result():
    res = MagicMock()
    user = MagicMock()
    user.id = "u1"
    user.email = "test.user@example.com"
    session = MagicMock()
    session.access_token = "access-123"
    session.refresh_token = "refresh-123"
    res.user = user
    res.session = session
    return res


def test_login_success():
    mobile, _ = _make_mobile()
    mobile.auth.sign_in_with_password.return_value = _session_result()
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/login",
            json={"email": "test.user@example.com", "password": "supersecret1"},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["access_token"] == "access-123"
    assert body["refresh_token"] == "refresh-123"
    assert body["user_id"] == "u1"


def test_login_wrong_password_401():
    mobile, _ = _make_mobile()
    mobile.auth.sign_in_with_password.side_effect = Exception("bad credentials")
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/login",
            json={"email": "test.user@example.com", "password": "wrong"},
        )
    assert r.status_code == 401


def test_forgot_password_always_200():
    mobile, _ = _make_mobile()
    with _patch_mobile(mobile):
        r = client.post(
            "/api/v1/auth/forgot-password",
            json={"email": "nobody@example.com"},
        )
    assert r.status_code == 200
    assert r.json() == {"sent": True}


def test_logout_200():
    r = client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    assert r.json() == {"logged_out": True}


# ---------------- /auth/link-profile ----------------


def _link(mobile, headers, body, validate_return=None):
    with _patch_mobile(mobile), patch.object(
        auth_service, "validate_supabase_jwt"
    ) as validator:
        validator.return_value = validate_return or {"sub": "u1", "email": "g@gmail.com"}
        return client.post("/api/v1/auth/link-profile", headers=headers, json=body)


_LINK_BODY = {"first_name": "Google", "last_name": "User", "phone": "03009998888"}


def test_link_profile_creates_row():
    mobile, table = _make_mobile()
    # profile_by_auth_user_id: miss, then insert, then hit on re-read
    table.execute.side_effect = [
        MagicMock(data=[]),
        MagicMock(data=[_PROFILE_ROW]),
        MagicMock(data=[_PROFILE_ROW]),
    ]
    r = _link(mobile, {"Authorization": "Bearer <redacted>"}, _LINK_BODY)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["created"] is True
    assert body["user_id"] == "u1"
    assert body["role"] == "customer"
    assert body["verification_status"] == "pending"
    # id = auth user UUID everywhere; email comes from the JWT, not the client
    inserted = table.insert.call_args[0][0]
    assert inserted["id"] == "u1"
    assert inserted["auth_user_id"] == "u1"
    assert inserted["email"] == "g@gmail.com"
    assert inserted["first_name"] == "Google"


def test_link_profile_idempotent():
    mobile, table = _make_mobile()
    table.execute.return_value = MagicMock(data=[_PROFILE_ROW])
    r = _link(mobile, {"Authorization": "Bearer <redacted>"}, _LINK_BODY)
    assert r.status_code == 200, r.text
    assert r.json()["created"] is False
    table.insert.assert_not_called()


def test_link_profile_no_token_401():
    mobile, _ = _make_mobile()
    r = _link(mobile, {}, _LINK_BODY)
    assert r.status_code == 401


def test_link_profile_bad_body_422():
    mobile, _ = _make_mobile()
    r = _link(mobile, {"Authorization": "Bearer <redacted>"}, {"first_name": "", "last_name": "User"})
    assert r.status_code == 422
