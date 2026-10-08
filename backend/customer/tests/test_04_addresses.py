"""Tests for /customer/addresses — mocked Supabase mobile client."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import addresses as addresses_router
from app.core.deps import get_current_customer

APP = FastAPI()
APP.include_router(addresses_router.router)
APP.dependency_overrides[get_current_customer] = lambda: "cust-1"
CLIENT = TestClient(APP)


def _row(id_, customer_id="cust-1", is_default=False, created="2026-10-01T00:00:00+00:00", **kw):
    row = {
        "id": id_,
        "customer_id": customer_id,
        "label": "Home",
        "recipient_name": "Test User",
        "phone": "+92 300 1234567",
        "address_line": "House 1, Street 2",
        "city": "Islamabad",
        "latitude": None,
        "longitude": None,
        "is_default": is_default,
        "created_at": created,
        "updated_at": created,
    }
    row.update(kw)
    return row


class _FakeTable:
    """Chainable fake for the supabase-py table builder; execute() pops canned results."""

    def __init__(self, results):
        self._results = list(results)
        self.calls = []

    def select(self, *args):
        self.calls.append(("select", args))
        return self

    def eq(self, col, val):
        self.calls.append(("eq", col, val))
        return self

    def limit(self, n):
        self.calls.append(("limit", n))
        return self

    def insert(self, data):
        self.calls.append(("insert", data))
        return self

    def update(self, data):
        self.calls.append(("update", data))
        return self

    def delete(self):
        self.calls.append(("delete",))
        return self

    def execute(self):
        data = self._results.pop(0) if self._results else []
        return SimpleNamespace(data=data)


@pytest.fixture
def fake_table():
    table = None

    def factory(results):
        nonlocal table
        table = _FakeTable(results)
        return table

    yield factory


@pytest.fixture
def client(fake_table):
    holder = {}

    def make(results):
        holder["table"] = fake_table(results)
        mock_client = MagicMock()
        mock_client.table.return_value = holder["table"]
        return mock_client

    with patch("app.services.address_service.get_mobile_client") as mock_get:
        mock_get.side_effect = lambda: make.current
        def _req(results):
            make.current = make(results)
            return holder["table"]
        yield _req


def test_list_default_first(client):
    table = client([
        [_row("a2", created="2026-10-03T00:00:00+00:00"),
         _row("a1", is_default=True, created="2026-10-01T00:00:00+00:00"),
         _row("a3", created="2026-10-02T00:00:00+00:00")],
    ])
    resp = CLIENT.get("/customer/addresses/")
    assert resp.status_code == 200
    ids = [r["id"] for r in resp.json()]
    assert ids == ["a1", "a2", "a3"]  # default first, then newest
    assert table.calls[0][0] == "select"


def test_create_first_address_becomes_default(client):
    created = _row("new-1", is_default=True)
    table = client([[], [created]])  # no existing -> insert result
    resp = CLIENT.post("/customer/addresses/", json={
        "label": "Home",
        "recipient_name": "Test User",
        "phone": "+92 300 1234567",
        "address_line": "House 1, Street 2",
        "city": "Islamabad",
    })
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_default"] is True
    insert_calls = [c for c in table.calls if c[0] == "insert"]
    assert len(insert_calls) == 1
    assert insert_calls[0][1]["is_default"] is True
    assert insert_calls[0][1]["customer_id"] == "cust-1"
    # no unset needed when there were no other addresses
    assert not [c for c in table.calls if c[0] == "update"]


def test_create_with_is_default_flips_others(client):
    existing = [_row("old-1", is_default=True)]
    created = _row("new-2", is_default=True)
    table = client([existing, [], [created]])  # existing -> unset result -> insert result
    resp = CLIENT.post("/customer/addresses/", json={
        "label": "Office",
        "recipient_name": "Test User",
        "phone": "03001234567",
        "address_line": "Office block 5",
        "city": "Rawalpindi",
        "is_default": True,
    })
    assert resp.status_code == 201
    assert resp.json()["is_default"] is True
    updates = [c for c in table.calls if c[0] == "update"]
    assert updates and updates[0][1] == {"is_default": False}  # unset others
    insert_calls = [c for c in table.calls if c[0] == "insert"]
    assert insert_calls[0][1]["is_default"] is True


def test_create_rejects_bad_phone(client):
    client([[]])
    resp = CLIENT.post("/customer/addresses/", json={
        "label": "Home",
        "recipient_name": "Test User",
        "phone": "abc!!",
        "address_line": "House 1",
        "city": "Islamabad",
    })
    assert resp.status_code == 422


def test_update_ok(client):
    owned = _row("a1", city="Islamabad")
    updated = _row("a1", city="Lahore")
    table = client([[owned], [updated]])  # get -> update result
    resp = CLIENT.put("/customer/addresses/a1", json={"city": "Lahore"})
    assert resp.status_code == 200
    assert resp.json()["city"] == "Lahore"
    updates = [c for c in table.calls if c[0] == "update"]
    assert updates and updates[0][1]["city"] == "Lahore"


def test_update_foreign_address_returns_404(client):
    client([[_row("a9", customer_id="cust-2")]])  # someone else's row
    resp = CLIENT.put("/customer/addresses/a9", json={"city": "Lahore"})
    assert resp.status_code == 404
    assert resp.json()["detail"] == "Address not found."


def test_update_missing_address_returns_404(client):
    client([[]])  # no row at all
    resp = CLIENT.put("/customer/addresses/nope", json={"city": "Lahore"})
    assert resp.status_code == 404


def test_delete_default_promotes_most_recent(client):
    gone = _row("a1", is_default=True)
    remaining = [_row("a2", created="2026-10-01T00:00:00+00:00"),
                 _row("a3", created="2026-10-05T00:00:00+00:00")]
    promoted = _row("a3", is_default=True, created="2026-10-05T00:00:00+00:00")
    table = client([[gone], [], remaining, [promoted]])  # get, delete, remaining, promote
    resp = CLIENT.delete("/customer/addresses/a1")
    assert resp.status_code == 200
    updates = [c for c in table.calls if c[0] == "update"]
    assert updates and updates[0][1]["is_default"] is True
    eqs = [c for c in table.calls if c[0] == "eq"]
    assert ("eq", "id", "a3") in eqs  # newest promoted


def test_delete_non_default_no_promotion(client):
    gone = _row("a2", is_default=False)
    table = client([[gone], []])  # get, delete result
    resp = CLIENT.delete("/customer/addresses/a2")
    assert resp.status_code == 200
    assert resp.json()["deleted"] is True
    assert not [c for c in table.calls if c[0] == "update"]


def test_set_default_unsets_others(client):
    owned = _row("a2")
    after = _row("a2", is_default=True)
    table = client([[owned], [], [after]])  # get, unset, set result
    resp = CLIENT.post("/customer/addresses/a2/set-default")
    assert resp.status_code == 200
    assert resp.json()["is_default"] is True
    updates = [c for c in table.calls if c[0] == "update"]
    assert updates[0][1] == {"is_default": False}  # all others unset first
    assert updates[1][1]["is_default"] is True
    assert updates[1][1]["updated_at"]


def test_set_default_foreign_address_returns_404(client):
    client([[_row("a9", customer_id="cust-2")]])
    resp = CLIENT.post("/customer/addresses/a9/set-default")
    assert resp.status_code == 404
