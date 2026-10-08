"""payments module: COD, bank-transfer proof, test-card gate, dues math."""
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app
from app.services import payment_service

CUSTOMER_ID = str(uuid.uuid4())
OTHER_CUSTOMER_ID = str(uuid.uuid4())
ORDER_ID = str(uuid.uuid4())
ORDER2_ID = str(uuid.uuid4())
OTHER_ORDER_ID = str(uuid.uuid4())
ORDER_TOTAL = 1250.0


# ---------------------------------------------------------------------------
# Fake Supabase client (chainable query builder + storage)
# ---------------------------------------------------------------------------
class _FakeResp:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, store, name):
        self._store = store  # list of row dicts
        self._name = name
        self._filters = []
        self._order = None
        self._insert_row = None
        self._tick = [0]

    # chainable query ops
    def select(self, *a, **k):
        return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self._filters.append(("neq", col, val))
        return self

    def in_(self, col, vals):
        vals = {str(v) for v in vals}
        self._filters.append(("in", col, vals))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def insert(self, row):
        self._insert_row = row
        return self

    def execute(self):
        if self._insert_row is not None:
            row = dict(self._insert_row)
            # server-side defaults the fake emulates
            row.setdefault(
                "created_at",
                (datetime.now(timezone.utc) + timedelta(microseconds=self._tick[0])).isoformat(),
            )
            self._tick[0] += 1
            self._store.append(row)
            return _FakeResp([dict(row)])
        rows = [dict(r) for r in self._store]
        for kind, col, val in self._filters:
            if kind == "eq":
                rows = [r for r in rows if str(r.get(col)) == str(val)]
            elif kind == "neq":
                rows = [r for r in rows if str(r.get(col)) != str(val)]
            elif kind == "in":
                rows = [r for r in rows if str(r.get(col)) in val]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: str(r.get(col) or ""), reverse=desc)
        return _FakeResp(rows)


class _FakeBucket:
    def __init__(self, name, calls):
        self._name = name
        self._calls = calls

    def upload(self, path, content, file_options=None):
        self._calls.append(
            {"bucket": self._name, "path": path, "content": content,
             "file_options": file_options or {}}
        )
        return {"Key": path}


class _FakeStorage:
    def __init__(self, calls):
        self._calls = calls

    def from_(self, bucket):
        return _FakeBucket(bucket, self._calls)


class _FakeClient:
    def __init__(self, seed_orders=None):
        self.tables = {
            "customer_orders": [dict(o) for o in (seed_orders or [])],
            "customer_payments": [],
        }
        self.upload_calls = []
        self.storage = _FakeStorage(self.upload_calls)

    def table(self, name):
        return _FakeTable(self.tables.setdefault(name, []), name)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
def _seed_orders():
    return [
        {"id": ORDER_ID, "customer_id": CUSTOMER_ID,
         "total_amount": ORDER_TOTAL, "status": "accepted"},
        {"id": ORDER2_ID, "customer_id": CUSTOMER_ID,
         "total_amount": 500.0, "status": "preparing"},
        {"id": OTHER_ORDER_ID, "customer_id": OTHER_CUSTOMER_ID,
         "total_amount": 999.0, "status": "accepted"},
    ]


@pytest.fixture()
def fake_db():
    return _FakeClient(seed_orders=_seed_orders())


@pytest.fixture()
def client(fake_db, monkeypatch):
    monkeypatch.setattr(payment_service, "get_mobile_client", lambda: fake_db)
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    app.dependency_overrides[get_current_customer] = lambda: CUSTOMER_ID
    yield TestClient(app)
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


@pytest.fixture()
def no_test_mode(monkeypatch):
    monkeypatch.delenv("PAYMENTS_TEST_MODE", raising=False)


@pytest.fixture()
def test_mode_on(monkeypatch):
    monkeypatch.setenv("PAYMENTS_TEST_MODE", "true")


# ---------------------------------------------------------------------------
# POST /payments/
# ---------------------------------------------------------------------------
def test_cod_creates_pending(client):
    r = client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "cod"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["method"] == "cod"
    assert body["amount"] == pytest.approx(ORDER_TOTAL)
    assert body["customer_id"] == CUSTOMER_ID
    assert body["order_id"] == ORDER_ID
    assert body["receipt_path"] is None


def test_bank_transfer_requires_receipt(client):
    r = client.post(
        "/api/v1/payments/", data={"order_id": ORDER_ID, "method": "bank_transfer"}
    )
    assert r.status_code == 422
    assert "receipt" in r.json()["detail"].lower()


def test_bank_transfer_with_receipt_uploads(client, fake_db):
    img = b"\xff\xd8fake-jpeg-bytes"
    r = client.post(
        "/api/v1/payments/",
        data={"order_id": ORDER_ID, "method": "bank_transfer"},
        files={"receipt": ("proof.jpg", img, "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "submitted"
    assert body["receipt_path"] is not None
    # storage bucket used and path namespaced by customer
    assert len(fake_db.upload_calls) == 1
    call = fake_db.upload_calls[0]
    assert call["bucket"] == "payment-receipts"
    assert call["path"] == body["receipt_path"] == f"{CUSTOMER_ID}/{body['id']}.jpg"
    assert call["content"] == img


def test_test_card_forbidden_when_disabled(client, no_test_mode):
    r = client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "test_card"})
    assert r.status_code == 403
    assert r.json() == {"detail": "Card payments are disabled."}


def test_test_card_paid_when_enabled(client, test_mode_on):
    r = client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "test_card"})
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "paid"


def test_duplicate_payment_conflicts(client):
    first = client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "cod"})
    assert first.status_code == 201
    second = client.post(
        "/api/v1/payments/",
        data={"order_id": ORDER_ID, "method": "bank_transfer"},
        files={"receipt": ("p.jpg", b"img", "image/jpeg")},
    )
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]


def test_foreign_order_404(client):
    r = client.post(
        "/api/v1/payments/", data={"order_id": OTHER_ORDER_ID, "method": "cod"}
    )
    assert r.status_code == 404


def test_missing_order_404(client):
    r = client.post(
        "/api/v1/payments/", data={"order_id": str(uuid.uuid4()), "method": "cod"}
    )
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /payments/history
# ---------------------------------------------------------------------------
def test_history_newest_first_with_order_total(client):
    p1 = client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "cod"}).json()
    p2 = client.post("/api/v1/payments/", data={"order_id": ORDER2_ID, "method": "cod"}).json()
    r = client.get("/api/v1/payments/history")
    assert r.status_code == 200
    hist = r.json()
    assert [p["id"] for p in hist] == [p2["id"], p1["id"]]
    by_id = {p["id"]: p for p in hist}
    assert by_id[p1["id"]]["order_total"] == pytest.approx(ORDER_TOTAL)
    assert by_id[p2["id"]]["order_total"] == pytest.approx(500.0)


# ---------------------------------------------------------------------------
# GET /payments/{id}
# ---------------------------------------------------------------------------
def test_payment_detail_ok(client):
    created = client.post(
        "/api/v1/payments/", data={"order_id": ORDER_ID, "method": "cod"}
    ).json()
    r = client.get(f"/api/v1/payments/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_payment_detail_404_missing(client):
    assert client.get(f"/api/v1/payments/{uuid.uuid4()}").status_code == 404


def test_payment_detail_404_other_customer(client, fake_db):
    fake_db.tables["customer_payments"].append({
        "id": str(uuid.uuid4()), "order_id": OTHER_ORDER_ID,
        "customer_id": OTHER_CUSTOMER_ID, "amount": 10.0,
        "method": "cod", "status": "pending", "receipt_path": None,
        "verified_by": None, "created_at": datetime.now(timezone.utc).isoformat(),
    })
    other_id = fake_db.tables["customer_payments"][-1]["id"]
    assert client.get(f"/api/v1/payments/{other_id}").status_code == 404


# ---------------------------------------------------------------------------
# GET /payments/dues
# ---------------------------------------------------------------------------
def test_dues_math(client, fake_db, test_mode_on):
    # active order, no payment -> due
    # active order 2, cod pending -> still due (pending is not settling)
    client.post("/api/v1/payments/", data={"order_id": ORDER2_ID, "method": "cod"})
    # active order 1, test_card paid -> settled, not due
    client.post("/api/v1/payments/", data={"order_id": ORDER_ID, "method": "test_card"})
    # terminal orders -> never due
    delivered = {"id": str(uuid.uuid4()), "customer_id": CUSTOMER_ID,
                 "total_amount": 200.0, "status": "delivered"}
    cancelled = {"id": str(uuid.uuid4()), "customer_id": CUSTOMER_ID,
                 "total_amount": 300.0, "status": "cancelled"}
    fake_db.tables["customer_orders"].extend([delivered, cancelled])

    r = client.get("/api/v1/payments/dues")
    assert r.status_code == 200
    body = r.json()
    due_ids = {o["order_id"] for o in body["unpaid_orders"]}
    assert ORDER2_ID in due_ids
    assert ORDER_ID not in due_ids
    assert delivered["id"] not in due_ids
    assert cancelled["id"] not in due_ids
    o2 = next(o for o in body["unpaid_orders"] if o["order_id"] == ORDER2_ID)
    assert o2["total_amount"] == pytest.approx(500.0)
    assert o2["status"] == "preparing"
    assert body["total_dues"] == pytest.approx(500.0)


def test_dues_empty_when_nothing_due(client):
    r = client.get("/api/v1/payments/dues")
    body = r.json()
    assert set(body["unpaid_orders"][0].keys()) == {"order_id", "total_amount", "status"}
    ids = {o["order_id"] for o in body["unpaid_orders"]}
    assert ids == {ORDER_ID, ORDER2_ID}
    assert body["total_dues"] == pytest.approx(ORDER_TOTAL + 500.0)
