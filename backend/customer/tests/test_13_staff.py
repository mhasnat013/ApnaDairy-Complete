"""Worker 13 — staff (web-admin) module tests.

STAFF_API_KEY is set here because worker 1's conftest (which normally sets it)
may not be present yet; if it later is, this is a harmless no-op default.
"""
import os

os.environ.setdefault("STAFF_API_KEY", "test-staff-key")

from unittest.mock import patch  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api.v1.staff import router  # noqa: E402
from app.services import staff_service  # noqa: E402

STAFF_HEADERS = {"X-Staff-Key": "test-staff-key"}


def make_app() -> TestClient:
    """Wrap the router in a real FastAPI app (bare TestClient(router) trips a
    fastapi/starlette version quirk about fastapi_middleware_astack)."""
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ------------------------------------------------------- fake supabase ------


class _Result:
    def __init__(self, data):
        self.data = data


class FakeTable:
    def __init__(self, name, store):
        self.name = name
        self.store = store
        self._filters = []
        self._order = None
        self._limit = None
        self._range = None
        self._op = None
        self._payload = None

    def select(self, *cols):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def _filtered(self):
        rows = list(self.store[self.name])
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: r.get(col) or "", reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        if self._range is not None:
            start, end = self._range
            rows = rows[start : end + 1]
        return rows

    def execute(self):
        if self._op == "insert":
            payload = dict(self._payload)
            payload.setdefault("id", f"{self.name}-{len(self.store[self.name]) + 1}")
            self.store[self.name].append(payload)
            return _Result([payload])
        if self._op == "update":
            rows = self._filtered()
            for r in rows:
                r.update(self._payload)
            return _Result(rows)
        return _Result(self._filtered())


class FakeClient:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return FakeTable(name, self.store)


def make_store():
    return {
        "customer_orders": [
            {
                "id": "o1",
                "customer_id": "c1",
                "area_manager_id": "m1",
                "status": "pending",
                "total_amount": 500,
                "currency": "PKR",
                "created_at": "2026-10-07T09:00:00+00:00",
            },
            {
                "id": "o2",
                "customer_id": "c2",
                "area_manager_id": "m2",
                "status": "accepted",
                "total_amount": 900,
                "currency": "PKR",
                "created_at": "2026-10-07T10:00:00+00:00",
            },
        ],
        "customer_deliveries": [
            {
                "id": "d1",
                "order_id": "o2",
                "customer_id": "c2",
                "status": "assigned",
                "events": [{"status": "assigned", "at": "t0", "by": "staff"}],
                "assigned_at": "2026-10-07T10:05:00+00:00",
            }
        ],
        "customer_payments": [
            {
                "id": "p1",
                "order_id": "o1",
                "customer_id": "c1",
                "amount": 500,
                "method": "bank_transfer",
                "status": "submitted",
            }
        ],
        "customer_complaints": [
            {
                "id": "cm1",
                "customer_id": "c1",
                "order_id": "o1",
                "category": "quality",
                "subject": "Sour milk",
                "status": "open",
                "messages": [{"from": "customer", "text": "sour", "at": "t0"}],
            }
        ],
        "customer_profiles": [
            {
                "id": "c1",
                "first_name": "Ali",
                "verification_status": "pending",
                "created_at": "2026-10-07T08:00:00+00:00",
            },
            {
                "id": "c2",
                "first_name": "Sara",
                "verification_status": "pending",
                "created_at": "2026-10-07T09:00:00+00:00",
            },
        ],
        "customer_notifications": [],
        "audit_logs": [],
    }


def make_client(store):
    """Client factory for TestClient: patches the service's mobile client."""
    fake = FakeClient(store)
    return make_app(), patch.object(
        staff_service, "get_mobile_client", lambda: fake
    )


# ----------------------------------------------------------------- auth -----


def test_missing_staff_key_is_401():
    with make_app() as client:
        r = client.get("/staff/orders")
    assert r.status_code == 401


def test_wrong_staff_key_is_403():
    with make_app() as client:
        r = client.get("/staff/orders", headers={"X-Staff-Key": "nope"})
    assert r.status_code == 403


def test_staff_key_ok():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.get("/staff/orders", headers=STAFF_HEADERS)
    assert r.status_code == 200


# ---------------------------------------------------------------- orders ----


def test_order_list_filters_and_newest_first():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.get("/staff/orders", headers=STAFF_HEADERS)
    items = r.json()["items"]
    assert [o["id"] for o in items] == ["o2", "o1"]  # newest first

    with ctx:
        r = client.get("/staff/orders?status=pending", headers=STAFF_HEADERS)
    assert [o["id"] for o in r.json()["items"]] == ["o1"]

    with ctx:
        r = client.get("/staff/orders?area_manager_id=m2", headers=STAFF_HEADERS)
    assert [o["id"] for o in r.json()["items"]] == ["o2"]

    with ctx:
        r = client.get(
            "/staff/orders?page=2&page_size=1", headers=STAFF_HEADERS
        )
    assert [o["id"] for o in r.json()["items"]] == ["o1"]


def test_valid_status_transition_updates_and_audits():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/o1/status",
            headers=STAFF_HEADERS,
            json={"status": "accepted", "note": "looks good"},
        )
    assert r.status_code == 200, r.text
    order = next(o for o in store["customer_orders"] if o["id"] == "o1")
    assert order["status"] == "accepted"
    # o1 has no delivery row -> skipped gracefully, no crash.
    notifs = store["customer_notifications"]
    assert any(n["kind"] == "order" and n["customer_id"] == "c1" for n in notifs)
    audits = store["audit_logs"]
    assert len(audits) == 1
    assert audits[0]["action"] == "order.status"
    assert audits[0]["meta"] == {
        "from": "pending",
        "to": "accepted",
        "note": "looks good",
    }


def test_valid_transition_appends_delivery_event():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/o2/status",
            headers=STAFF_HEADERS,
            json={"status": "preparing"},
        )
    assert r.status_code == 200, r.text
    delivery = next(d for d in store["customer_deliveries"] if d["id"] == "d1")
    assert delivery["events"][-1]["status"] == "preparing"
    assert delivery["events"][-1]["by"] == "staff"
    assert len(store["audit_logs"]) == 1


def test_invalid_transition_is_422():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/o1/status",
            headers=STAFF_HEADERS,
            json={"status": "delivered"},
        )
    assert r.status_code == 422
    assert "Invalid status transition" in r.json()["detail"]
    order = next(o for o in store["customer_orders"] if o["id"] == "o1")
    assert order["status"] == "pending"
    assert store["audit_logs"] == []


def test_terminal_status_has_no_outgoing_transitions():
    store = make_store()
    store["customer_orders"].append(
        {"id": "o9", "customer_id": "c1", "status": "delivered"}
    )
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/o9/status",
            headers=STAFF_HEADERS,
            json={"status": "cancelled"},
        )
    assert r.status_code == 422


def test_status_change_unknown_order_is_404():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/nope/status",
            headers=STAFF_HEADERS,
            json={"status": "accepted"},
        )
    assert r.status_code == 404


def test_assign_rider_inserts_when_no_delivery():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/orders/o1/assign-rider",
            headers=STAFF_HEADERS,
            json={
                "rider_name": "Rashid",
                "rider_phone": "03001234567",
                "vehicle_label": "Bike",
                "vehicle_plate": "LHR-123",
            },
        )
    assert r.status_code == 200, r.text
    deliveries = [d for d in store["customer_deliveries"] if d["order_id"] == "o1"]
    assert len(deliveries) == 1
    d = deliveries[0]
    assert d["status"] == "assigned"
    assert d["customer_id"] == "c1"  # taken from the order
    assert d["rider_name"] == "Rashid"
    assert d["events"][0]["status"] == "assigned"
    notifs = store["customer_notifications"]
    assert any(n["kind"] == "delivery" and n["customer_id"] == "c1" for n in notifs)
    assert len(store["audit_logs"]) == 1


def test_assign_rider_updates_latest_when_delivery_exists():
    store = make_store()
    client, ctx = make_client(store)
    before = len(store["customer_deliveries"])
    with ctx:
        r = client.post(
            "/staff/orders/o2/assign-rider",
            headers=STAFF_HEADERS,
            json={"rider_name": "Bilal", "rider_phone": "03007654321"},
        )
    assert r.status_code == 200, r.text
    assert len(store["customer_deliveries"]) == before  # upsert, no new row
    d = next(x for x in store["customer_deliveries"] if x["id"] == "d1")
    assert d["rider_name"] == "Bilal"
    assert d["rider_phone"] == "03007654321"


# --------------------------------------------------------------- payments ----


def test_payment_list_filter():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.get("/staff/payments", headers=STAFF_HEADERS)
    assert r.status_code == 200
    assert r.json()["items"][0]["id"] == "p1"

    with ctx:
        r = client.get("/staff/payments?status=verified", headers=STAFF_HEADERS)
    assert r.json()["items"] == []


def test_payment_verify_and_reject():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/payments/p1/verify",
            headers=STAFF_HEADERS,
            json={"verified": True, "note": "receipt ok"},
        )
    assert r.status_code == 200, r.text
    p = next(x for x in store["customer_payments"] if x["id"] == "p1")
    assert p["status"] == "verified"
    assert p["verified_by"] == "staff"
    notifs = store["customer_notifications"]
    assert any(n["kind"] == "payment" for n in notifs)
    assert len(store["audit_logs"]) == 1

    with ctx:
        r = client.post(
            "/staff/payments/p1/verify",
            headers=STAFF_HEADERS,
            json={"verified": False},
        )
    assert r.status_code == 200
    assert next(x for x in store["customer_payments"] if x["id"] == "p1")[
        "status"
    ] == "rejected"


def test_payment_verify_unknown_is_404():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/payments/nope/verify",
            headers=STAFF_HEADERS,
            json={"verified": True},
        )
    assert r.status_code == 404


# ------------------------------------------------------------- complaints ----


def test_complaint_list_and_respond():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.get("/staff/complaints", headers=STAFF_HEADERS)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1

    with ctx:
        r = client.post(
            "/staff/complaints/cm1/respond",
            headers=STAFF_HEADERS,
            json={"text": "Replacement sent.", "status": "resolved"},
        )
    assert r.status_code == 200, r.text
    c = next(x for x in store["customer_complaints"] if x["id"] == "cm1")
    assert c["status"] == "resolved"
    assert c["messages"][-1] == {
        "from": "staff",
        "text": "Replacement sent.",
        "at": c["messages"][-1]["at"],
    }
    assert c["messages"][-1]["from"] == "staff"
    assert len(c["messages"]) == 2  # original + staff reply
    notifs = store["customer_notifications"]
    assert any(n["kind"] == "complaint" and n["customer_id"] == "c1" for n in notifs)
    assert len(store["audit_logs"]) == 1


def test_complaint_respond_bad_status_is_422():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/complaints/cm1/respond",
            headers=STAFF_HEADERS,
            json={"text": "hi", "status": "bogus"},
        )
    assert r.status_code == 422


# -------------------------------------------------------------- customers ----


def test_customer_list_filter():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.get("/staff/customers", headers=STAFF_HEADERS)
    assert r.status_code == 200
    assert len(r.json()["items"]) == 2

    with ctx:
        r = client.get(
            "/staff/customers?verification_status=approved", headers=STAFF_HEADERS
        )
    assert r.json()["items"] == []


def test_customer_verify_approve_with_area_manager():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/customers/c1/verify",
            headers=STAFF_HEADERS,
            json={"approved": True, "area_manager_id": "m1"},
        )
    assert r.status_code == 200, r.text
    c = next(x for x in store["customer_profiles"] if x["id"] == "c1")
    assert c["verification_status"] == "approved"
    assert c["area_manager_id"] == "m1"
    notifs = store["customer_notifications"]
    assert any(n["kind"] == "verification" and n["customer_id"] == "c1" for n in notifs)
    audits = store["audit_logs"]
    assert len(audits) == 1
    assert audits[0]["action"] == "customer.verify"


def test_customer_verify_reject_with_reason():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/customers/c2/verify",
            headers=STAFF_HEADERS,
            json={"approved": False, "rejection_reason": "blurry CNIC"},
        )
    assert r.status_code == 200, r.text
    c = next(x for x in store["customer_profiles"] if x["id"] == "c2")
    assert c["verification_status"] == "rejected"
    assert store["audit_logs"][0]["meta"]["rejection_reason"] == "blurry CNIC"


def test_customer_verify_unknown_is_404():
    store = make_store()
    client, ctx = make_client(store)
    with ctx:
        r = client.post(
            "/staff/customers/nope/verify",
            headers=STAFF_HEADERS,
            json={"approved": True},
        )
    assert r.status_code == 404
