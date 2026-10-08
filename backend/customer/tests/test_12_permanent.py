"""Worker 12 — permanent-customer subscription requests + ledger.

Hermetic: supabase clients are faked in-memory; auth is overridden to 'cust-1'.
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app

BASE = "/api/v1/permanent"


class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, store, name):
        self._store = store
        self._name = name
        self._eq = []
        self._in = []
        self._order = None
        self._limit = None
        self._insert = None
        self._update = None

    def select(self, *cols):
        return self

    def eq(self, col, val):
        self._eq.append((col, val))
        return self

    def in_(self, col, vals):
        self._in.append((col, set(vals)))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def insert(self, payload):
        self._insert = dict(payload)
        return self

    def update(self, payload):
        self._update = dict(payload)
        return self

    def _rows(self):
        return self._store.setdefault(self._name, [])

    def _matches(self, row):
        return all(row.get(c) == v for c, v in self._eq) and all(
            row.get(c) in vs for c, vs in self._in
        )

    def execute(self):
        if self._insert is not None:
            row = dict(self._insert)
            row.setdefault("id", f"{self._name}-{len(self._rows()) + 1}")
            row.setdefault("created_at", "2026-10-07T10:00:00+00:00")
            row.setdefault("updated_at", "2026-10-07T10:00:00+00:00")
            self._rows().append(row)
            return _Result([row])
        if self._update is not None:
            updated = []
            for row in self._rows():
                if self._matches(row):
                    row.update(self._update)
                    updated.append(row)
            return _Result(updated)
        rows = [r for r in self._rows() if self._matches(r)]
        if self._order:
            col, desc = self._order
            rows.sort(key=lambda r: (r.get(col) is None, r.get(col)), reverse=desc)
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)


class FakeMobileClient:
    def __init__(self):
        self.store = {}

    def table(self, name):
        return _FakeQuery(self.store, name)


def seed_profile(client, customer_id="cust-1", status="approved"):
    client.store.setdefault("customer_profiles", []).append(
        {"id": customer_id, "verification_status": status}
    )


def seed_request(client, **kw):
    row = {
        "id": kw.get("id", "req-1"),
        "customer_id": kw.get("customer_id", "cust-1"),
        "cycle": kw.get("cycle", "15"),
        "status": kw.get("status", "pending"),
        "start_date": kw.get("start_date", "2026-10-07"),
        "end_date": kw.get("end_date", "2026-10-22"),
        "rejection_reason": kw.get("rejection_reason"),
        "plan_details": {"daily_quantity_l": kw.get("daily_quantity_l", 2.0)},
        "created_at": kw.get("created_at", "2026-10-07T09:00:00+00:00"),
        "updated_at": "2026-10-07T09:00:00+00:00",
    }
    client.store.setdefault("customer_permanent_requests", []).append(row)
    return row


def seed_ledger(client, entries):
    client.store.setdefault("customer_ledger", []).extend(entries)


@pytest.fixture()
def fake():
    client = FakeMobileClient()
    seed_profile(client, status="approved")
    with patch(
        "app.services.permanent_service.get_mobile_client", return_value=client
    ), patch("app.services.ledger_service.get_mobile_client", return_value=client):
        yield client


@pytest.fixture()
def authed():
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    app.dependency_overrides[get_current_customer] = lambda: "cust-1"
    yield
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


@pytest.fixture()
def tclient():
    return TestClient(app)


# --- verification gate ------------------------------------------------------


def test_unverified_customer_cannot_request(fake, authed, tclient):
    fake.store["customer_profiles"] = []  # drop the approved profile
    seed_profile(fake, status="pending")
    r = tclient.post(
        f"{BASE}/request",
        json={"cycle": "15", "daily_quantity_l": 2.0, "start_date": "2026-10-07"},
    )
    assert r.status_code == 403
    assert r.json() == {"detail": "Only verified customers can request permanent subscription."}


# --- request creation -------------------------------------------------------


def test_request_ok_and_end_date_math(fake, authed, tclient):
    r = tclient.post(
        f"{BASE}/request",
        json={"cycle": "15", "daily_quantity_l": 2.5, "start_date": "2026-10-07"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "pending"
    assert body["cycle"] == "15"
    assert body["customer_id"] == "cust-1"
    assert body["start_date"] == "2026-10-07"
    assert body["end_date"] == "2026-10-22"  # +15 days
    assert body["daily_quantity_l"] == 2.5


def test_request_30_day_end_date(fake, authed, tclient):
    r = tclient.post(
        f"{BASE}/request",
        json={"cycle": "30", "daily_quantity_l": 1.0, "start_date": "2026-10-07"},
    )
    assert r.status_code == 201
    assert r.json()["end_date"] == "2026-11-06"  # +30 days


@pytest.mark.parametrize("status", ["pending", "approved", "paused"])
def test_duplicate_active_request_409(fake, authed, tclient, status):
    seed_request(fake, status=status)
    r = tclient.post(
        f"{BASE}/request",
        json={"cycle": "15", "daily_quantity_l": 2.0, "start_date": "2026-10-07"},
    )
    assert r.status_code == 409
    assert "already have an active" in r.json()["detail"]


def test_new_request_allowed_after_rejected(fake, authed, tclient):
    seed_request(fake, status="rejected")
    r = tclient.post(
        f"{BASE}/request",
        json={"cycle": "15", "daily_quantity_l": 2.0, "start_date": "2026-10-07"},
    )
    assert r.status_code == 201


def test_request_validation(fake, authed, tclient):
    base = {"cycle": "15", "daily_quantity_l": 2.0, "start_date": "2026-10-07"}
    r = tclient.post(f"{BASE}/request", json={**base, "start_date": "2026-10-01"})
    assert r.status_code == 422  # past start_date
    r = tclient.post(f"{BASE}/request", json={**base, "daily_quantity_l": 0})
    assert r.status_code == 422  # quantity must be > 0
    r = tclient.post(f"{BASE}/request", json={**base, "cycle": "45"})
    assert r.status_code == 422  # only 15|30


# --- status -----------------------------------------------------------------


def test_status_none(fake, authed, tclient):
    r = tclient.get(f"{BASE}/status")
    assert r.status_code == 200
    assert r.json() == {"status": "none"}


def test_status_returns_latest(fake, authed, tclient):
    seed_request(fake, id="req-old", status="rejected",
                 created_at="2026-10-01T09:00:00+00:00")
    seed_request(fake, id="req-new", status="approved",
                 created_at="2026-10-06T09:00:00+00:00")
    r = tclient.get(f"{BASE}/status")
    assert r.status_code == 200
    assert r.json()["id"] == "req-new"


# --- pause / resume / cancel ------------------------------------------------


def test_pause_resume_cycle(fake, authed, tclient):
    seed_request(fake, id="req-1", status="approved")
    r = tclient.post(f"{BASE}/requests/req-1/pause")
    assert r.status_code == 200
    assert r.json()["status"] == "paused"

    r = tclient.post(f"{BASE}/requests/req-1/pause")  # already paused
    assert r.status_code == 409

    r = tclient.post(f"{BASE}/requests/req-1/resume")
    assert r.status_code == 200
    assert r.json()["status"] == "approved"

    r = tclient.post(f"{BASE}/requests/req-1/resume")  # not paused
    assert r.status_code == 409


def test_pause_pending_409(fake, authed, tclient):
    seed_request(fake, id="req-1", status="pending")
    r = tclient.post(f"{BASE}/requests/req-1/pause")
    assert r.status_code == 409


def test_cancel_pending(fake, authed, tclient):
    seed_request(fake, id="req-1", status="pending")
    r = tclient.post(f"{BASE}/requests/req-1/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"

    r = tclient.post(f"{BASE}/requests/req-1/cancel")  # already cancelled
    assert r.status_code == 409


def test_cancel_rejected_409(fake, authed, tclient):
    seed_request(fake, id="req-1", status="rejected")
    r = tclient.post(f"{BASE}/requests/req-1/cancel")
    assert r.status_code == 409


def test_transitions_on_foreign_request_404(fake, authed, tclient):
    seed_request(fake, id="req-9", customer_id="cust-2", status="approved")
    for action in ("pause", "resume", "cancel"):
        r = tclient.post(f"{BASE}/requests/req-9/{action}")
        assert r.status_code == 404


# --- ledger -----------------------------------------------------------------


def test_ledger_balance_math_and_order(fake, authed, tclient):
    seed_ledger(
        fake,
        [
            {
                "id": "e1",
                "customer_id": "cust-1",
                "entry_type": "subscription_charge",
                "amount": -5000,
                "ref": "sub-oct",
                "created_at": "2026-10-01T09:00:00+00:00",
            },
            {
                "id": "e2",
                "customer_id": "cust-1",
                "entry_type": "payment",
                "amount": 2000,
                "ref": "bank-xfer",
                "created_at": "2026-10-03T09:00:00+00:00",
            },
            {
                "id": "e3",
                "customer_id": "cust-1",
                "entry_type": "adjustment",
                "amount": -500,
                "ref": None,
                "created_at": "2026-10-05T09:00:00+00:00",
            },
            {
                "id": "eX",
                "customer_id": "cust-2",  # someone else's entry: excluded
                "entry_type": "payment",
                "amount": 99999,
                "ref": None,
                "created_at": "2026-10-06T09:00:00+00:00",
            },
        ],
    )
    r = tclient.get(f"{BASE}/ledger")
    assert r.status_code == 200
    body = r.json()
    assert [e["id"] for e in body["entries"]] == ["e3", "e2", "e1"]  # newest first
    assert body["balance"] == -3500  # -5000 + 2000 - 500


def test_ledger_empty(fake, authed, tclient):
    r = tclient.get(f"{BASE}/ledger")
    assert r.status_code == 200
    assert r.json() == {"entries": [], "balance": 0}
