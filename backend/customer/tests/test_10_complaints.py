"""Tests for the complaints module (worker 10).

TestClient + dependency_overrides for auth; the mobile Supabase client is
replaced with an in-memory fake via monkeypatch on
app.services.complaint_service.get_mobile_client.
"""

from datetime import datetime, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app
from app.services import complaint_service


# ---------------------------------------------------------------------------
# In-memory fake Supabase client (chainable query builder + fake storage)
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
        self._limit = None

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

    def eq(self, col, val):
        self._rows = [r for r in self._rows if r.get(col) == val]
        return self

    def order(self, col, desc=False):
        self._rows.sort(
            key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc
        )
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self._mode == "update":
            out = list(self._rows)
            for r in out:
                r.update(self._updates)
            if self._limit is not None:
                out = out[: self._limit]
            return _Result(out)
        if self._mode == "insert":
            row = dict(self._insert_row)
            row.setdefault("id", str(uuid4()))
            row.setdefault("created_at", datetime.now(timezone.utc).isoformat())
            self._store.append(row)
            return _Result([row])
        rows = list(self._rows)
        if self._limit is not None:
            rows = rows[: self._limit]
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


class _FakeStorageBucket:
    def __init__(self, client):
        self._client = client

    def upload(self, path, contents, file_options=None):
        if self._client.storage_missing:
            raise Exception('Bucket not found: "complaint-attachments"')
        self._client.uploads.append(
            {"path": path, "contents": contents, "options": file_options}
        )
        return {"Key": path}


class _FakeStorage:
    def __init__(self, client):
        self._client = client

    def from_(self, bucket):
        assert bucket == complaint_service.ATTACHMENT_BUCKET, bucket
        return _FakeStorageBucket(self._client)


class FakeMobileClient:
    def __init__(self):
        self.complaints = []
        self.orders = []
        self.uploads = []
        self.storage_missing = False
        self.storage = _FakeStorage(self)

    def table(self, name):
        if name == "customer_complaints":
            return _Table(self.complaints)
        if name == "customer_orders":
            return _Table(self.orders)
        raise AssertionError(f"unexpected table: {name}")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


import pytest  # noqa: E402


@pytest.fixture
def fake_db(monkeypatch):
    client = FakeMobileClient()

    # orders: one owned by cust-1, one foreign
    client.orders.append({"id": "order-1", "customer_id": "cust-1"})
    client.orders.append({"id": "order-2", "customer_id": "cust-2"})

    def seed_complaint(customer_id, category, status, created_at, **kw):
        client.complaints.append(
            {
                "id": str(uuid4()),
                "customer_id": customer_id,
                "order_id": None,
                "category": category,
                "subject": "seed subject",
                "description": "seed description text",
                "photo_path": None,
                "status": status,
                "messages": [],
                "created_at": created_at,
                "updated_at": created_at,
                **kw,
            }
        )
        return client.complaints[-1]["id"]

    ids = {}
    ids["old_open"] = seed_complaint(
        "cust-1", "rider", "open", "2026-10-01T10:00:00+00:00"
    )
    ids["new_resolved"] = seed_complaint(
        "cust-1", "quality", "resolved", "2026-10-05T10:00:00+00:00"
    )
    ids["foreign"] = seed_complaint(
        "cust-2", "payment", "open", "2026-10-06T10:00:00+00:00"
    )

    monkeypatch.setattr(
        complaint_service, "get_mobile_client", lambda: client
    )
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    app.dependency_overrides[get_current_customer] = lambda: "cust-1"
    yield {"client": client, "ids": ids, "seed_complaint": seed_complaint}
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


@pytest.fixture
def http(fake_db):
    return TestClient(app)


def _form(**kw):
    base = {
        "category": "quality",
        "subject": "Sour milk delivered",
        "description": "The milk smelled sour on arrival this morning.",
    }
    base.update(kw)
    return base


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


def test_create_ok(http, fake_db):
    r = http.post("/api/v1/complaints/", data=_form())
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["customer_id"] == "cust-1"
    assert body["category"] == "quality"
    assert body["status"] == "open"
    assert body["messages"] == []
    assert body["photo_path"] is None
    assert body["id"]
    stored = [c for c in fake_db["client"].complaints if c["id"] == body["id"]]
    assert len(stored) == 1


def test_create_with_own_order(http):
    r = http.post("/api/v1/complaints/", data=_form(order_id="order-1"))
    assert r.status_code == 201, r.text
    assert r.json()["order_id"] == "order-1"


def test_create_with_foreign_order_id_404(http):
    r = http.post("/api/v1/complaints/", data=_form(order_id="order-2"))
    assert r.status_code == 404
    assert r.json() == {"detail": "Order not found."}


def test_create_with_unknown_order_id_404(http):
    r = http.post("/api/v1/complaints/", data=_form(order_id="nope"))
    assert r.status_code == 404


def test_create_invalid_category_422(http):
    r = http.post("/api/v1/complaints/", data=_form(category="bogus"))
    assert r.status_code == 422


def test_create_short_subject_422(http):
    r = http.post("/api/v1/complaints/", data=_form(subject="ab"))
    assert r.status_code == 422


def test_create_short_description_422(http):
    r = http.post("/api/v1/complaints/", data=_form(description="too short"))
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# Photo upload
# ---------------------------------------------------------------------------


def test_create_with_photo_ok(http, fake_db):
    files = {"photo": ("milk.jpg", b"\xff\xd8fake-jpeg", "image/jpeg")}
    r = http.post("/api/v1/complaints/", data=_form(), files=files)
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["photo_path"] == f"cust-1/{body['id']}.jpg"

    uploads = fake_db["client"].uploads
    assert len(uploads) == 1
    assert uploads[0]["path"] == f"cust-1/{body['id']}.jpg"
    assert uploads[0]["contents"] == b"\xff\xd8fake-jpeg"
    assert uploads[0]["options"] == {"content-type": "image/jpeg"}


def test_create_photo_bucket_missing_503(http, fake_db):
    fake_db["client"].storage_missing = True
    try:
        files = {"photo": ("milk.jpg", b"\xff\xd8fake-jpeg", "image/jpeg")}
        r = http.post("/api/v1/complaints/", data=_form(), files=files)
        assert r.status_code == 503
        assert r.json() == {
            "detail": "Attachment storage not configured yet."
        }
    finally:
        fake_db["client"].storage_missing = False
    # the complaint row must not be created when the upload fails
    assert len(fake_db["client"].complaints) == 3


# ---------------------------------------------------------------------------
# List / detail
# ---------------------------------------------------------------------------


def test_list_newest_first_own_only(http):
    r = http.get("/api/v1/complaints/")
    assert r.status_code == 200
    items = r.json()
    assert [c["status"] for c in items] == ["resolved", "open"]
    assert all(c["customer_id"] == "cust-1" for c in items)


def test_list_status_filter(http):
    r = http.get("/api/v1/complaints/", params={"status": "open"})
    assert r.status_code == 200
    items = r.json()
    assert len(items) == 1
    assert items[0]["status"] == "open"
    assert items[0]["customer_id"] == "cust-1"


def test_list_invalid_status_422(http):
    r = http.get("/api/v1/complaints/", params={"status": "bogus"})
    assert r.status_code == 422


def test_detail_own_includes_messages(http, fake_db):
    cid = fake_db["ids"]["old_open"]
    r = http.get(f"/api/v1/complaints/{cid}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == cid
    assert body["messages"] == []
    assert body["category"] == "rider"


def test_detail_foreign_404(http, fake_db):
    r = http.get(f"/api/v1/complaints/{fake_db['ids']['foreign']}")
    assert r.status_code == 404
    assert r.json() == {"detail": "Complaint not found."}


def test_detail_unknown_404(http):
    r = http.get("/api/v1/complaints/does-not-exist")
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def test_message_append(http, fake_db):
    cid = fake_db["ids"]["old_open"]
    r = http.post(
        f"/api/v1/complaints/{cid}/messages", json={"text": "Any update?"}
    )
    assert r.status_code == 200, r.text
    messages = r.json()
    assert len(messages) == 1
    assert messages[0]["from"] == "customer"
    assert messages[0]["text"] == "Any update?"
    assert messages[0]["at"]

    # appended again, thread grows; detail shows both
    r = http.post(
        f"/api/v1/complaints/{cid}/messages", json={"text": "Second note."}
    )
    assert [m["text"] for m in r.json()] == ["Any update?", "Second note."]
    assert [m["text"] for m in http.get(f"/api/v1/complaints/{cid}").json()["messages"]] == [
        "Any update?",
        "Second note.",
    ]


def test_message_empty_text_422(http, fake_db):
    r = http.post(
        f"/api/v1/complaints/{fake_db['ids']['old_open']}/messages",
        json={"text": ""},
    )
    assert r.status_code == 422


def test_message_foreign_complaint_404(http, fake_db):
    r = http.post(
        f"/api/v1/complaints/{fake_db['ids']['foreign']}/messages",
        json={"text": "hello"},
    )
    assert r.status_code == 404
    assert r.json() == {"detail": "Complaint not found."}
