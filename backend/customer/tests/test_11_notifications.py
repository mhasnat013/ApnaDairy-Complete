"""Tests for the notifications module (worker 11).

TestClient + dependency_overrides for auth; the mobile Supabase client is
replaced with an in-memory fake via monkeypatch on
app.services.notification_service.get_mobile_client.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app
from app.services import notification_service


# ---------------------------------------------------------------------------
# In-memory fake Supabase client (chainable query builder)
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store):
        self._store = store            # shared backing list (mutable)
        self._rows = list(store)        # rows selected so far
        self._mode = "select"
        self._updates = None
        self._insert_row = None
        self._orders = []
        self._rng = None

    def select(self, *args, **kwargs):
        self._mode = "select"
        return self

    def insert(self, row):
        self._mode = "insert"
        self._insert_row = dict(row)
        return self

    def update(self, values):
        self._mode = "update"
        self._updates = dict(values)
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def order(self, col, desc=False):
        self._orders.append((col, desc))
        return self

    def range(self, start, stop):
        self._rng = (start, stop)
        return self

    def execute(self):
        if self._mode == "update":
            for r in self._rows:
                r.update(self._updates)
            return _Result(list(self._rows))
        if self._mode == "delete":
            out = list(self._rows)
            for r in out:
                self._store.remove(r)
            return _Result(out)
        if self._mode == "insert":
            row = dict(self._insert_row)
            row.setdefault("id", str(uuid4()))
            row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            self._store.append(row)
            return _Result([row])
        rows = list(self._rows)
        for col, desc in reversed(self._orders):  # later order() wins
            rows.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        if self._rng is not None:
            rows = rows[self._rng[0] : self._rng[1] + 1]
        return _Result(rows)


class _Table:
    def __init__(self, store):
        self._store = store

    def select(self, *a, **k):
        return _Query(self._store).select(*a, **k)

    def insert(self, row):
        return _Query(self._store).insert(row)

    def update(self, values):
        return _Query(self._store).update(values)

    def delete(self):
        return _Query(self._store).delete()


class FakeMobileClient:
    def __init__(self):
        self.store = []

    def table(self, name):
        assert name == "customer_notifications", name
        return _Table(self.store)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def fake_db(monkeypatch):
    client = FakeMobileClient()

    def seed(customer_id, title, is_read, created_at, kind="order"):
        client.store.append(
            {
                "id": str(uuid4()),
                "customer_id": customer_id,
                "title": title,
                "body": f"body of {title}",
                "kind": kind,
                "is_read": is_read,
                "created_at": created_at,
            }
        )
        return client.store[-1]["id"]

    # cust-1 rows: mixed read/unread and timestamps
    ids = {}
    ids["read_old"] = seed("cust-1", "read-old", True, "2026-10-01T10:00:00+00:00")
    ids["unread_old"] = seed("cust-1", "unread-old", False, "2026-10-02T10:00:00+00:00")
    ids["unread_new"] = seed("cust-1", "unread-new", False, "2026-10-03T10:00:00+00:00")
    ids["read_new"] = seed("cust-1", "read-new", True, "2026-10-04T10:00:00+00:00")
    # another customer's row (foreign)
    ids["foreign"] = seed("cust-2", "foreign", False, "2026-10-05T10:00:00+00:00")

    monkeypatch.setattr(
        notification_service, "get_mobile_client", lambda: client
    )
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    app.dependency_overrides[get_current_customer] = lambda: "cust-1"
    yield {"client": client, "ids": ids, "seed": seed}
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


@pytest.fixture
def http(fake_db):
    return TestClient(app)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_list_unread_first_then_newest(http):
    r = http.get("/api/v1/notifications/")
    assert r.status_code == 200
    body = r.json()
    assert body["unread_count"] == 2
    titles = [n["title"] for n in body["items"]]
    assert titles == ["unread-new", "unread-old", "read-new", "read-old"]
    assert body["page"] == 1 and body["page_size"] == 20


def test_list_unread_only(http):
    r = http.get("/api/v1/notifications/", params={"unread_only": True})
    assert r.status_code == 200
    body = r.json()
    assert body["unread_count"] == 2
    titles = [n["title"] for n in body["items"]]
    assert titles == ["unread-new", "unread-old"]


def test_list_pagination(http):
    r = http.get("/api/v1/notifications/", params={"page": 2, "page_size": 3})
    body = r.json()
    assert [n["title"] for n in body["items"]] == ["read-old"]
    assert body["page"] == 2 and body["page_size"] == 3
    # foreign customer's notification never leaks into cust-1's list
    assert all(n["customer_id"] == "cust-1" for n in body["items"])


def test_read_one(http, fake_db):
    nid = fake_db["ids"]["unread_new"]
    r = http.post(f"/api/v1/notifications/{nid}/read")
    assert r.status_code == 200
    assert r.json()["is_read"] is True

    # unread count drops and the row moves below remaining unread
    body = http.get("/api/v1/notifications/").json()
    assert body["unread_count"] == 1
    assert [n["title"] for n in body["items"]][0] == "unread-old"


def test_read_foreign_id_404(http, fake_db):
    r = http.post(f"/api/v1/notifications/{fake_db['ids']['foreign']}/read")
    assert r.status_code == 404
    assert r.json() == {"detail": "Notification not found."}

    r = http.post("/api/v1/notifications/does-not-exist/read")
    assert r.status_code == 404


def test_read_all(http):
    r = http.post("/api/v1/notifications/read-all")
    assert r.status_code == 200
    assert r.json() == {"marked": 2}

    body = http.get("/api/v1/notifications/").json()
    assert body["unread_count"] == 0
    assert all(n["is_read"] for n in body["items"])

    # second call marks nothing
    assert http.post("/api/v1/notifications/read-all").json() == {"marked": 0}


def test_delete_own(http, fake_db):
    nid = fake_db["ids"]["read_old"]
    r = http.delete(f"/api/v1/notifications/{nid}")
    assert r.status_code == 200
    assert r.json() == {"deleted": True}
    assert len(fake_db["client"].store) == 4
    assert nid not in [row["id"] for row in fake_db["client"].store]


def test_delete_foreign_id_404(http, fake_db):
    r = http.delete(f"/api/v1/notifications/{fake_db['ids']['foreign']}")
    assert r.status_code == 404
    assert len(fake_db["client"].store) == 5  # nothing removed

    r = http.delete("/api/v1/notifications/does-not-exist")
    assert r.status_code == 404


def test_create_notification_helper(fake_db):
    row = notification_service.create_notification(
        "cust-1", "Order delivered", "Your order is at the door.", kind="delivery"
    )
    assert row["customer_id"] == "cust-1"
    assert row["title"] == "Order delivered"
    assert row["body"] == "Your order is at the door."
    assert row["kind"] == "delivery"
    assert row["is_read"] is False
    assert row["id"]
    assert row["created_at"]

    stored = [r for r in fake_db["client"].store if r["id"] == row["id"]]
    assert len(stored) == 1
    assert stored[0]["kind"] == "delivery"


def test_create_notification_default_kind(fake_db):
    row = notification_service.create_notification("cust-1", "Hi", "hello")
    assert row["kind"] == "general"


def test_create_notification_bad_kind(fake_db):
    with pytest.raises(ValueError):
        notification_service.create_notification("cust-1", "Hi", "hello", kind="sms")
