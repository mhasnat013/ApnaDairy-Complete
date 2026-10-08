"""Tests for profile + verification modules (worker 3).

Supabase is never hit: get_mobile_client is patched in each service module and
the returned MagicMock self-chains through select/eq/order/limit/update/insert
so any call order works.
"""
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app
from app.services import profile_service, verification_service

app.dependency_overrides[get_current_customer] = lambda: "cust-1"
client = TestClient(app)

_PROFILE_ROW = {
    "id": "cust-1",
    "auth_user_id": "auth-1",
    "first_name": "Ali",
    "last_name": "Raza",
    "email": "ali@example.com",
    "phone": "03001234567",
    "role": "customer",
    "verification_status": "pending",
    "area_manager_id": None,
    "created_at": "2026-10-01T00:00:00+00:00",
    "updated_at": "2026-10-01T00:00:00+00:00",
}


def _chain_mock(rows):
    """Mobile client whose table() chain always resolves .execute() -> rows."""
    mobile = MagicMock()
    table = MagicMock()
    mobile.table.return_value = table
    table.select.return_value = table
    table.eq.return_value = table
    table.order.return_value = table
    table.limit.return_value = table
    table.update.return_value = table
    table.insert.return_value = table
    table.execute.return_value = MagicMock(data=rows)
    return mobile, table


def _patch(module, rows):
    mobile, table = _chain_mock(rows)
    return patch.object(module, "get_mobile_client", return_value=mobile), table


# ---------------- profile ----------------


def test_get_profile_ok():
    p, _ = _patch(profile_service, [_PROFILE_ROW])
    with p:
        r = client.get("/api/v1/profile/")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "cust-1"
    assert body["email"] == "ali@example.com"


def test_get_profile_404():
    p, _ = _patch(profile_service, [])
    with p:
        r = client.get("/api/v1/profile/")
    assert r.status_code == 404
    assert "detail" in r.json()


def test_update_profile_ok():
    updated = {**_PROFILE_ROW, "first_name": "Ahmed", "phone": "03009998877"}
    p, table = _patch(profile_service, [updated])
    with p:
        r = client.put(
            "/api/v1/profile/", json={"first_name": "Ahmed", "phone": "03009998877"}
        )
    assert r.status_code == 200
    body = r.json()
    assert body["first_name"] == "Ahmed"
    assert body["phone"] == "03009998877"
    # update() must only carry whitelisted fields + updated_at
    sent = table.update.call_args.args[0]
    assert set(sent) == {"first_name", "phone", "updated_at"}
    assert sent["first_name"] == "Ahmed"


def test_update_profile_forbidden_field_422():
    p, _ = _patch(profile_service, [_PROFILE_ROW])
    with p:
        r = client.put("/api/v1/profile/", json={"email": "hack@example.com"})
    assert r.status_code == 422
    assert "detail" in r.json()


def test_update_profile_forbidden_role_422():
    p, _ = _patch(profile_service, [_PROFILE_ROW])
    with p:
        r = client.put("/api/v1/profile/", json={"role": "super_admin"})
    assert r.status_code == 422


# ---------------- verification submit ----------------


def _submit_payload():
    return {
        "full_name": "Ali Raza",
        "phone": "03001234567",
        "address": "House 1, Street 2, Lahore",
        "notes": "n/a",
    }


def test_verification_submit_ok():
    created = {
        "id": "v-1",
        "customer_id": "cust-1",
        "status": "submitted",
        "documents": _submit_payload(),
        "submitted_at": "2026-10-07T00:00:00+00:00",
    }

    # select-chain returns [] (no active submission), insert returns created row
    mobile = MagicMock()
    select_chain = MagicMock()
    select_chain.select.return_value = select_chain
    select_chain.eq.return_value = select_chain
    select_chain.order.return_value = select_chain
    select_chain.limit.return_value = select_chain
    select_chain.execute.return_value = MagicMock(data=[])  # no active row

    insert_chain = MagicMock()
    insert_chain.execute.return_value = MagicMock(data=[created])

    profiles = MagicMock()
    profiles.update.return_value = profiles
    profiles.eq.return_value = profiles
    profiles.execute.return_value = MagicMock(data=[_PROFILE_ROW])

    def table_side_effect(name):
        if name == "customer_verifications":
            return MagicMock(
                select=select_chain.select,
                insert=lambda payload: insert_chain,
            )
        return profiles

    mobile.table.side_effect = table_side_effect

    with patch.object(verification_service, "get_mobile_client", return_value=mobile):
        r = client.post("/api/v1/verification/submit", json=_submit_payload())
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "submitted"
    assert body["customer_id"] == "cust-1"
    # profile's verification_status must be flipped to submitted
    profiles.update.assert_called_once_with({"verification_status": "submitted"})


def test_verification_submit_duplicate_409():
    active = {
        "id": "v-0",
        "customer_id": "cust-1",
        "status": "submitted",
        "documents": {},
        "submitted_at": "2026-10-06T00:00:00+00:00",
    }
    p, _ = _patch(verification_service, [active])
    with p:
        r = client.post("/api/v1/verification/submit", json=_submit_payload())
    assert r.status_code == 409
    assert "detail" in r.json()


# ---------------- verification status ----------------


def test_verification_status_none():
    p, _ = _patch(verification_service, [])
    with p:
        r = client.get("/api/v1/verification/status")
    assert r.status_code == 200
    assert r.json()["status"] == "pending"


def test_verification_status_submitted():
    row = {
        "status": "submitted",
        "rejection_reason": None,
        "submitted_at": "2026-10-07T00:00:00+00:00",
    }
    p, _ = _patch(verification_service, [row])
    with p:
        r = client.get("/api/v1/verification/status")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "submitted"
    assert body["rejection_reason"] is None
    assert body["submitted_at"] == "2026-10-07T00:00:00+00:00"


def test_verification_status_rejected():
    row = {
        "status": "rejected",
        "rejection_reason": "CNIC unreadable",
        "submitted_at": "2026-10-07T00:00:00+00:00",
    }
    p, _ = _patch(verification_service, [row])
    with p:
        r = client.get("/api/v1/verification/status")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "rejected"
    assert body["rejection_reason"] == "CNIC unreadable"


# ---------------- document upload ----------------


def test_document_upload_ok():
    mobile = MagicMock()
    bucket = MagicMock()
    mobile.storage.from_.return_value = bucket
    bucket.upload.return_value = {"path": "cust-1/cnic_front_abc.jpg"}

    with patch.object(verification_service, "get_mobile_client", return_value=mobile):
        r = client.post(
            "/api/v1/verification/documents",
            data={"doc_type": "cnic_front"},
            files={"file": ("cnic.jpg", b"fake-image-bytes", "image/jpeg")},
        )
    assert r.status_code == 200
    body = r.json()
    assert body["doc_type"] == "cnic_front"
    assert body["path"].startswith("cust-1/cnic_front_")
    assert body["path"].endswith(".jpg")
    bucket.upload.assert_called_once()


def test_document_upload_invalid_doc_type_422():
    mobile = MagicMock()
    with patch.object(verification_service, "get_mobile_client", return_value=mobile):
        r = client.post(
            "/api/v1/verification/documents",
            data={"doc_type": "passport"},
            files={"file": ("doc.jpg", b"fake", "image/jpeg")},
        )
    assert r.status_code == 422


def test_document_upload_bucket_missing_503():
    mobile = MagicMock()
    bucket = MagicMock()
    mobile.storage.from_.return_value = bucket
    bucket.upload.side_effect = Exception("Bucket 'customer-documents' not found")

    with patch.object(verification_service, "get_mobile_client", return_value=mobile):
        r = client.post(
            "/api/v1/verification/documents",
            data={"doc_type": "profile_photo"},
            files={"file": ("me.png", b"fake", "image/png")},
        )
    assert r.status_code == 503
    assert r.json()["detail"] == "Document storage not configured yet."
