"""Cart module tests: GET/POST/PUT/DELETE on /cart, totals, price snapshot.

Fakes the Supabase clients by patching app.services.cart_service.get_mobile_client
and get_web_client with an in-memory chainable fake. Auth is overridden to
customer "cust-1".
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.services.cart_service as cart_service
from app.core.deps import get_current_customer
from app.main import app


# ---------- in-memory supabase fake ----------

class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table):
        self._table = table
        self._op = "select"
        self._payload = None
        self._eqs = []
        self._ins = []
        self._limit = None

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

    def delete(self):
        self._op = "delete"
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def in_(self, col, vals):
        self._ins.append((col, list(vals)))
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        return self._table._run(self)

    @property
    def rows(self):
        return self._table.rows


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows  # list of dicts, shared mutable state
        self.ops = []  # record of write ops for assertions

    def _match(self, q):
        out = []
        for row in self.rows:
            ok = all(row.get(c) == v for c, v in q._eqs)
            ok = ok and all(row.get(c) in vals for c, vals in q._ins)
            if ok:
                out.append(row)
        if q._limit is not None:
            out = out[: q._limit]
        return out

    def _run(self, q):
        if q._op == "select":
            return _Result([dict(r) for r in self._match(q)])
        if q._op == "insert":
            row = dict(q._payload)
            row["id"] = row.get("id") or f"row-{len(self.rows) + 1}"
            self.rows.append(row)
            self.ops.append(("insert", dict(row)))
            return _Result([dict(row)])
        if q._op == "update":
            matched = self._match(q)
            self.ops.append(("update", [dict(r) for r in matched]))
            for row in matched:
                row.update(q._payload)
            return _Result([dict(r) for r in matched])
        if q._op == "delete":
            matched = self._match(q)
            self.ops.append(("delete", [dict(r) for r in matched]))
            for row in matched:
                self.rows.remove(row)
            return _Result([dict(r) for r in matched])
        raise AssertionError(f"unknown op {q._op}")


class _FakeClient:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _FakeQuery(self._tables[name])


def make_clients(products, cart_rows):
    web = _FakeClient({"products": _FakeTable([dict(p) for p in products])})
    mobile = _FakeClient(
        {
            "customer_carts": _FakeTable(
                [{"id": "cart-1", "customer_id": "cust-1", "area_manager_id": None}]
            ),
            "customer_cart_items": _FakeTable([dict(r) for r in cart_rows]),
        }
    )
    return web, mobile


@pytest.fixture
def client():
    _sentinel = object()
    prev = app.dependency_overrides.get(get_current_customer, _sentinel)
    app.dependency_overrides[get_current_customer] = lambda: "cust-1"
    with TestClient(app) as c:
        yield c
    if prev is _sentinel:
        app.dependency_overrides.pop(get_current_customer, None)
    else:
        app.dependency_overrides[get_current_customer] = prev


def patch_clients(web, mobile):
    return (
        patch.object(cart_service, "get_web_client", return_value=web),
        patch.object(cart_service, "get_mobile_client", return_value=mobile),
    )


PRODUCTS = [
    {"id": "p-1", "name": "Desi Ghee", "price": 100, "discount_pct": 20, "is_available": True},
    {"id": "p-2", "name": "Fresh Milk", "price": 240, "discount_pct": 0, "is_available": True},
    {"id": "p-3", "name": "Old Cheese", "price": 50, "discount_pct": 10, "is_available": False},
]


def cart_state():
    return [
        {"id": "i1", "cart_id": "cart-1", "product_id": "p-1", "quantity": 2, "unit_price": 80.0},
        {"id": "i2", "cart_id": "cart-1", "product_id": "p-2", "quantity": 1, "unit_price": 240.0},
        {"id": "iX", "cart_id": "cart-2", "product_id": "p-1", "quantity": 5, "unit_price": 80.0},
    ]


# ---------- tests ----------

def test_get_cart_totals(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/cart/")
    assert r.status_code == 200
    body = r.json()
    assert body["total_items"] == 3
    assert body["total_amount"] == 2 * 80.0 + 1 * 240.0
    assert len(body["items"]) == 2  # cust-2's item not included
    items = {i["id"]: i for i in body["items"]}
    assert items["i1"]["line_total"] == 160.0
    assert items["i1"]["product_name"] == "Desi Ghee"
    assert items["i2"]["line_total"] == 240.0


def test_get_cart_empty(client):
    web, mobile = make_clients(PRODUCTS, [])
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/cart/")
    assert r.status_code == 200
    assert r.json() == {"items": [], "total_items": 0, "total_amount": 0}


def test_add_new_item_snapshots_price(client):
    web, mobile = make_clients(PRODUCTS, [])
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/cart/items", json={"product_id": "p-1", "quantity": 3})
    assert r.status_code == 201
    body = r.json()
    assert body["product_id"] == "p-1"
    assert body["product_name"] == "Desi Ghee"
    assert body["quantity"] == 3
    assert body["unit_price"] == 80.0  # 100 * (1 - 20/100)
    assert body["line_total"] == 240.0
    rows = mobile.table("customer_cart_items").rows
    assert len(rows) == 1
    assert rows[0]["cart_id"] == "cart-1"
    assert rows[0]["quantity"] == 3


def test_add_existing_item_increments(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/cart/items", json={"product_id": "p-1", "quantity": 2})
    assert r.status_code == 201
    assert r.json()["quantity"] == 4  # 2 + 2
    rows = [x for x in mobile.table("customer_cart_items").rows if x["id"] == "i1"]
    assert len(rows) == 1
    assert rows[0]["quantity"] == 4


def test_add_unavailable_product_404(client):
    web, mobile = make_clients(PRODUCTS, [])
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/cart/items", json={"product_id": "p-3", "quantity": 1})
    assert r.status_code == 404
    assert r.json() == {"detail": "Product not available."}


def test_add_missing_product_404(client):
    web, mobile = make_clients(PRODUCTS, [])
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/cart/items", json={"product_id": "p-nope", "quantity": 1})
    assert r.status_code == 404
    assert r.json() == {"detail": "Product not available."}


def test_add_invalid_quantity_rejected(client):
    r = client.post("/api/v1/cart/items", json={"product_id": "p-1", "quantity": 0})
    assert r.status_code == 422


def test_update_quantity(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.put("/api/v1/cart/items/i1", json={"quantity": 5})
    assert r.status_code == 200
    assert r.json()["quantity"] == 5
    rows = [x for x in mobile.table("customer_cart_items").rows if x["id"] == "i1"]
    assert rows[0]["quantity"] == 5


def test_update_quantity_zero_deletes(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.put("/api/v1/cart/items/i1", json={"quantity": 0})
    assert r.status_code == 204
    ids = [x["id"] for x in mobile.table("customer_cart_items").rows]
    assert "i1" not in ids
    assert "i2" in ids


def test_update_foreign_item_404(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.put("/api/v1/cart/items/iX", json={"quantity": 1})
    assert r.status_code == 404
    assert r.json() == {"detail": "Cart item not found."}


def test_delete_item(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.delete("/api/v1/cart/items/i2")
    assert r.status_code == 204
    ids = [x["id"] for x in mobile.table("customer_cart_items").rows]
    assert "i2" not in ids
    assert "i1" in ids and "iX" in ids


def test_delete_foreign_item_404(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.delete("/api/v1/cart/items/iX")
    assert r.status_code == 404
    assert r.json() == {"detail": "Cart item not found."}


def test_clear_cart(client):
    web, mobile = make_clients(PRODUCTS, cart_state())
    pw, pm = patch_clients(web, mobile)
    with pw, pm:
        r = client.delete("/api/v1/cart/")
    assert r.status_code == 204
    rows = mobile.table("customer_cart_items").rows
    assert len(rows) == 1  # only cust-2's item remains
    assert rows[0]["id"] == "iX"
