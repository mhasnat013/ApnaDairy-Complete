"""Worker 9/14 — /rider (deliveries/rider module).

TestClient + dependency_overrides; patches
app.services.rider_service.get_mobile_client with an in-memory fake
backed by the real customer_deliveries column set.
"""
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app

CUSTOMER = "cust-1"
OTHER = "cust-2"


# ---------------------------------------------------------------- fake client

class _Resp:
    def __init__(self, data):
        self.data = data


class _FakeTable:
    def __init__(self, store):
        self._store = store
        self._eqs: dict[str, Any] = {}
        self._order = None
        self._limit = None
        self._updates = None

    def select(self, *_a, **_k):
        return self

    def eq(self, key, value):
        self._eqs[key] = value
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def update(self, values):
        self._updates = values
        return self

    def execute(self):
        rows = [r for r in self._store.values() if all(r.get(k) == v for k, v in self._eqs.items())]
        if self._updates is not None:
            for r in rows:
                r.update(self._updates)
            return _Resp(rows)
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: r.get(col) or "", reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Resp(rows)


class _FakeClient:
    def __init__(self, rows):
        self._store = {r["id"]: dict(r) for r in rows}

    def table(self, name):
        assert name == "customer_deliveries"
        return _FakeTable(self._store)


def _delivery(**kw):
    row = {
        "id": "del-1",
        "order_id": "ord-1",
        "customer_id": CUSTOMER,
        "rider_id": "rider-7",
        "rider_name": "Bilal Ahmed",
        "rider_phone": "+92 300 1234567",
        "vehicle_label": "Suzuki Carry",
        "vehicle_plate": "ICT-123",
        "rider_rating": 4.6,
        "status": "on_the_way",
        "current_latitude": 33.6844,
        "current_longitude": 73.0479,
        "messages": [{"from": "rider", "text": "On my way", "at": "2026-10-07T08:00:00+00:00"}],
        "events": [{"status": "picked_up", "at": "2026-10-07T07:45:00+00:00", "note": None}],
        "customer_rating": None,
        "customer_rating_comment": None,
        "rider_photo_path": "riders/rider-7.jpg",
        "assigned_at": "2026-10-07T07:30:00+00:00",
        "delivered_at": None,
    }
    row.update(kw)
    return row


@pytest.fixture
def client():
    app.dependency_overrides[get_current_customer] = lambda: CUSTOMER
    rows = [
        _delivery(),
        _delivery(
            id="del-2",
            order_id="ord-2",
            rider_id=None,
            rider_name=None,
            rider_phone=None,
            rider_rating=None,
            rider_photo_path=None,
            current_latitude=None,
            current_longitude=None,
            messages=[],
            assigned_at="2026-10-07T09:00:00+00:00",
        ),
        _delivery(id="del-3", order_id="ord-3", customer_id=OTHER),
        _delivery(id="del-4", order_id="ord-4", status="delivered", delivered_at="2026-10-07T10:00:00+00:00"),
    ]
    fake = _FakeClient(rows)
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    with patch("app.services.rider_service.get_mobile_client", return_value=fake):
        yield TestClient(app)
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


# ------------------------------------------------------------------- GET order

def test_delivery_detail_with_rider(client):
    r = client.get("/api/v1/rider/order/ord-1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["delivery_id"] == "del-1"
    assert body["order_id"] == "ord-1"
    assert body["status"] == "on_the_way"
    assert body["rider"]["name"] == "Bilal Ahmed"
    assert body["rider"]["phone"] == "+92 300 1234567"
    assert body["rider"]["rating"] == 4.6
    assert body["rider"]["vehicle_plate"] == "ICT-123"
    assert body["message"] is None
    assert body["live"] == {"latitude": 33.6844, "longitude": 73.0479}
    assert body["messages"][0]["from"] == "rider"
    assert body["events"][0]["status"] == "picked_up"


def test_delivery_detail_without_rider_honest_null(client):
    r = client.get("/api/v1/rider/order/ord-2")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["rider"] is None
    assert body["message"] == "Rider not assigned yet."
    assert body["live"] == {"latitude": None, "longitude": None}


def test_delivery_detail_no_delivery_404(client):
    r = client.get("/api/v1/rider/order/ord-999")
    assert r.status_code == 404


def test_delivery_detail_foreign_order_404(client):
    # del-3 belongs to another customer -> must not leak
    r = client.get("/api/v1/rider/order/ord-3")
    assert r.status_code == 404


# --------------------------------------------------------------------- message

def test_message_appends(client):
    r = client.post("/api/v1/rider/deliveries/del-1/message", json={"text": "Gate pe aa jain"})
    assert r.status_code == 200, r.text
    msgs = r.json()["messages"]
    assert len(msgs) == 2
    assert msgs[-1]["from"] == "customer"
    assert msgs[-1]["text"] == "Gate pe aa jain"
    assert msgs[-1]["at"]  # timestamp present


def test_message_empty_text_422(client):
    r = client.post("/api/v1/rider/deliveries/del-1/message", json={"text": ""})
    assert r.status_code == 422


def test_message_on_foreign_delivery_404(client):
    r = client.post("/api/v1/rider/deliveries/del-3/message", json={"text": "hello"})
    assert r.status_code == 404


def test_message_unknown_delivery_404(client):
    r = client.post("/api/v1/rider/deliveries/nope/message", json={"text": "hello"})
    assert r.status_code == 404


# ------------------------------------------------------------------------ rate

def test_rate_allowed_only_when_delivered(client):
    r = client.post(
        "/api/v1/rider/deliveries/del-4/rate",
        json={"rating": 5, "comment": "Fresh milk, on time"},
    )
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}


def test_rate_before_delivered_422(client):
    r = client.post("/api/v1/rider/deliveries/del-1/rate", json={"rating": 4})
    assert r.status_code == 422
    assert "detail" in r.json()


@pytest.mark.parametrize("rating", [0, 6, -1, 100])
def test_rating_bounds_422(client, rating):
    r = client.post(
        "/api/v1/rider/deliveries/del-4/rate", json={"rating": rating}
    )
    assert r.status_code == 422


def test_rate_foreign_delivery_404(client):
    r = client.post("/api/v1/rider/deliveries/del-3/rate", json={"rating": 5})
    assert r.status_code == 404
