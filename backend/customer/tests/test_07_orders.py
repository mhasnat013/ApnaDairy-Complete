"""Checkout + orders module tests: per-manager order split, idempotency,
empty cart, foreign address, cancel rules, reorder, detail timeline.

Fakes the Supabase clients by patching app.services.order_service.get_mobile_client
and get_web_client with an in-memory chainable fake. Auth is overridden to
customer "cust-1".
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import app.services.order_service as order_service
from app.core.deps import get_current_customer
from app.main import app


# ---------- in-memory supabase fake (adds .order() on top of the cart one) ----------

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
        self._order_col = None
        self._order_desc = False

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

    def order(self, col, desc=False):
        self._order_col = col
        self._order_desc = desc
        return self

    def execute(self):
        return self._table._run(self)

    @property
    def rows(self):
        return self._table.rows


class _FakeTable:
    def __init__(self, rows):
        self.rows = rows
        self.ops = []

    def _match(self, q):
        out = []
        for row in self.rows:
            ok = all(row.get(c) == v for c, v in q._eqs)
            ok = ok and all(row.get(c) in vals for c, vals in q._ins)
            if ok:
                out.append(row)
        if q._order_col is not None:
            out.sort(
                key=lambda r: str(r.get(q._order_col) or ""),
                reverse=q._order_desc,
            )
        if q._limit is not None:
            out = out[: q._limit]
        return out

    def _run(self, q):
        if q._op == "select":
            return _Result([dict(r) for r in self._match(q)])
        if q._op == "insert":
            payloads = (
                q._payload if isinstance(q._payload, list) else [q._payload]
            )
            made = []
            for p in payloads:
                row = dict(p)
                row["id"] = row.get("id") or f"row-{len(self.rows) + 1}"
                self.rows.append(row)
                self.ops.append(("insert", dict(row)))
                made.append(dict(row))
            return _Result(made)
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
        if name not in self._tables:
            self._tables[name] = _FakeTable([])
        return _FakeQuery(self._tables[name])


def make_clients(products, cart_rows, addresses, orders=None, items=None,
                 deliveries=None, notifications=None):
    web = _FakeClient({"products": _FakeTable([dict(p) for p in products])})
    mobile = _FakeClient(
        {
            "customer_carts": _FakeTable(
                [{"id": "cart-1", "customer_id": "cust-1", "area_manager_id": "mgr-1"}]
            ),
            "customer_cart_items": _FakeTable([dict(r) for r in cart_rows]),
            "customer_addresses": _FakeTable([dict(r) for r in addresses]),
            "customer_orders": _FakeTable([dict(r) for r in (orders or [])]),
            "customer_order_items": _FakeTable([dict(r) for r in (items or [])]),
            "customer_deliveries": _FakeTable([dict(r) for r in (deliveries or [])]),
            "customer_notifications": _FakeTable(
                [dict(r) for r in (notifications or [])]
            ),
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
    from app.services import cart_service

    return (
        patch.object(order_service, "get_web_client", return_value=web),
        patch.object(order_service, "get_mobile_client", return_value=mobile),
        patch.object(cart_service, "get_mobile_client", return_value=mobile),
    )


PRODUCTS = [
    {"id": "p-1", "name": "Desi Ghee", "price": 100.0,
     "discount_pct": 0, "area_manager_id": "m-1"},
    {"id": "p-2", "name": "Fresh Milk", "price": 240.0,
     "discount_pct": 0, "area_manager_id": "m-2"},
    {"id": "p-3", "name": "Butter", "price": 50.0,
     "discount_pct": 0, "area_manager_id": "m-1"},
]

ADDRESSES = [
    {"id": "addr-1", "customer_id": "cust-1", "city": "Lahore",
     "address_line": "12 Main St"},
    {"id": "addr-X", "customer_id": "cust-2", "city": "Karachi",
     "address_line": "9 Other St"},
]


def cart_state():
    return [
        {"id": "i1", "cart_id": "cart-1", "product_id": "p-1",
         "quantity": 2, "unit_price": 100.0},
        {"id": "i2", "cart_id": "cart-1", "product_id": "p-2",
         "quantity": 1, "unit_price": 240.0},
        {"id": "i3", "cart_id": "cart-1", "product_id": "p-3",
         "quantity": 3, "unit_price": 50.0},
    ]


CHECKOUT_BODY = {"address_id": "addr-1", "payment_method": "cod",
                 "note": "leave at gate"}


# ---------- checkout ----------

def test_checkout_splits_two_managers_into_two_orders(client):
    web, mobile = make_clients(PRODUCTS, cart_state(), ADDRESSES)
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/checkout/", json=CHECKOUT_BODY)
    assert r.status_code == 200
    body = r.json()
    assert len(body["orders"]) == 2
    by_mgr = {o["area_manager_id"]: o for o in body["orders"]}
    assert set(by_mgr) == {"m-1", "m-2"}
    # m-1: 2x100 + 3x50 = 350 ; m-2: 1x240 = 240
    assert by_mgr["m-1"]["total_amount"] == 350.0
    assert by_mgr["m-2"]["total_amount"] == 240.0
    assert by_mgr["m-1"]["status"] == "pending"
    assert by_mgr["m-1"]["payment_method"] == "cod"
    assert by_mgr["m-2"]["note"] == "leave at gate"
    assert len(by_mgr["m-1"]["items"]) == 2
    assert len(by_mgr["m-2"]["items"]) == 1
    # currency + address snapshot stored
    assert by_mgr["m-1"]["currency"] == "PKR"
    ck = mobile.table("customer_orders").rows[0]["customer_checkout"]
    assert ck["address_snapshot"]["id"] == "addr-1"
    assert ck["address_snapshot"]["city"] == "Lahore"
    # cart cleared
    assert [r2 for r2 in mobile.table("customer_cart_items").rows
            if r2["cart_id"] == "cart-1"] == []
    # order item rows written (best effort)
    assert len(mobile.table("customer_order_items").rows) == 3
    # one notification per order
    notes = mobile.table("customer_notifications").rows
    assert len(notes) == 2
    assert all(n["kind"] == "order" and n["title"] == "Order placed"
               for n in notes)


def test_checkout_idempotent_same_key_returns_existing(client):
    web, mobile = make_clients(PRODUCTS, cart_state(), ADDRESSES)
    pw, pm, _pcm = patch_clients(web, mobile)
    headers = {"Idempotency-Key": "key-123"}
    with pw, pm, _pcm:
        r1 = client.post("/api/v1/checkout/", json=CHECKOUT_BODY, headers=headers)
        r2 = client.post("/api/v1/checkout/", json=CHECKOUT_BODY, headers=headers)
    assert r1.status_code == 200
    assert r2.status_code == 200
    assert [o["id"] for o in r2.json()["orders"]] == [
        o["id"] for o in r1.json()["orders"]]
    # no duplicate rows created
    assert len(mobile.table("customer_orders").rows) == 2


def test_checkout_idempotency_hit_with_empty_cart_returns_existing(client):
    # A retried request: cart already cleared, but the key must still
    # return the original orders instead of 404.
    orders = [
        {"id": "o-1", "customer_id": "cust-1", "area_manager_id": "m-1",
         "address_id": "addr-1", "status": "pending", "total_amount": 350.0,
         "currency": "PKR",
         "customer_checkout": {"idempotency_key": "dup-1",
                               "payment_method": "cod", "note": None,
                               "items": [], "address_snapshot": {}}},
    ]
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=orders)
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/checkout/", json=CHECKOUT_BODY,
                        headers={"Idempotency-Key": "dup-1"})
    assert r.status_code == 200
    assert len(r.json()["orders"]) == 1
    assert r.json()["orders"][0]["id"] == "o-1"


def test_checkout_empty_cart_404(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES)
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/checkout/", json=CHECKOUT_BODY)
    assert r.status_code == 404
    assert r.json() == {"detail": "Cart is empty."}
    assert mobile.table("customer_orders").rows == []


def test_checkout_foreign_address_404(client):
    web, mobile = make_clients(PRODUCTS, cart_state(), ADDRESSES)
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/checkout/",
                        json={"address_id": "addr-X",
                              "payment_method": "cod"})
    assert r.status_code == 404
    assert r.json() == {"detail": "Address not found."}
    # cart untouched
    assert len([r2 for r2 in mobile.table("customer_cart_items").rows
                if r2["cart_id"] == "cart-1"]) == 3


def test_checkout_invalid_payment_method_422(client):
    r = client.post("/api/v1/checkout/",
                    json={"address_id": "addr-1",
                          "payment_method": "easypaisa"})
    assert r.status_code == 422


# ---------- orders: list / detail ----------

def _order_rows():
    return [
        {"id": "o-1", "customer_id": "cust-1", "area_manager_id": "m-1",
         "address_id": "addr-1", "status": "pending", "total_amount": 350.0,
         "currency": "PKR", "created_at": "2026-10-07T09:00:00",
         "customer_checkout": {"payment_method": "cod", "note": None}},
        {"id": "o-2", "customer_id": "cust-1", "area_manager_id": "m-2",
         "address_id": "addr-1", "status": "delivered", "total_amount": 240.0,
         "currency": "PKR", "created_at": "2026-10-07T10:00:00",
         "customer_checkout": {"payment_method": "bank_transfer",
                               "note": "gate"}},
        {"id": "o-X", "customer_id": "cust-2", "area_manager_id": "m-1",
         "address_id": "addr-X", "status": "pending", "total_amount": 99.0,
         "currency": "PKR", "created_at": "2026-10-07T11:00:00",
         "customer_checkout": {}},
    ]


def _item_rows():
    return [
        {"id": "oi-1", "order_id": "o-1", "product_id": "p-1",
         "product_name": "Desi Ghee", "quantity": 2, "unit_price": 100.0},
        {"id": "oi-2", "order_id": "o-1", "product_id": "p-3",
         "product_name": "Butter", "quantity": 3, "unit_price": 50.0},
    ]


def _delivery_rows():
    return [
        {"id": "d-1", "order_id": "o-1", "customer_id": "cust-1",
         "status": "pending", "created_at": "2026-10-07T09:05:00",
         "events": [
             {"type": "created", "message": "Order received",
              "created_at": "2026-10-07T09:00:00"},
             {"type": "preparing", "message": "Packed by manager",
              "created_at": "2026-10-07T09:04:00"},
         ]},
    ]


def test_list_orders_newest_first_and_filtered(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.get("/api/v1/orders/")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 2  # cust-2's order excluded
    assert [o["id"] for o in body["orders"]] == ["o-2", "o-1"]  # newest first
    assert body["page"] == 1 and body["page_size"] == 20

    with pw, pm, _pcm:
        r = client.get("/api/v1/orders/", params={"status": "pending"})
    assert r.status_code == 200
    assert r.json()["total"] == 1
    assert r.json()["orders"][0]["id"] == "o-1"


def test_order_detail_includes_items_and_events(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES,
                               orders=_order_rows(), items=_item_rows(),
                               deliveries=_delivery_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.get("/api/v1/orders/o-1")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == "o-1"
    assert body["status"] == "pending"
    assert len(body["items"]) == 2
    assert body["items"][0]["product_name"] == "Desi Ghee"
    assert body["items"][0]["line_total"] == 200.0
    assert len(body["timeline"]) == 2
    assert body["timeline"][0]["type"] == "created"
    assert body["timeline"][1]["message"] == "Packed by manager"


def test_order_detail_foreign_order_404(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.get("/api/v1/orders/o-X")
    assert r.status_code == 404
    assert r.json() == {"detail": "Order not found."}


# ---------- cancel ----------

def test_cancel_pending_order(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/orders/o-1/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    rows = {row["id"]: row for row in mobile.table("customer_orders").rows}
    assert rows["o-1"]["status"] == "cancelled"
    notes = mobile.table("customer_notifications").rows
    assert len(notes) == 1
    assert notes[0]["kind"] == "order"
    assert notes[0]["title"] == "Order cancelled"


def test_cancel_delivered_order_forbidden(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/orders/o-2/cancel")
    assert r.status_code == 400
    assert r.json() == {
        "detail": "Order cannot be cancelled in status 'delivered'."}
    rows = {row["id"]: row for row in mobile.table("customer_orders").rows}
    assert rows["o-2"]["status"] == "delivered"  # unchanged


def test_cancel_foreign_order_404(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/orders/o-X/cancel")
    assert r.status_code == 404


# ---------- reorder ----------

def test_reorder_copies_items_into_cart(client):
    web, mobile = make_clients(
        PRODUCTS,
        [{"id": "c1", "cart_id": "cart-1", "product_id": "p-1",
          "quantity": 5, "unit_price": 100.0}],  # existing p-1 row: upsert
        ADDRESSES, orders=_order_rows(), items=_item_rows(),
    )
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/orders/o-1/reorder")
    assert r.status_code == 200
    body = r.json()
    assert body["added_items"] == 5          # 2 + 3 quantities
    assert body["total_amount"] == 350.0     # 2x100 + 3x50
    cart = {row["product_id"]: row
            for row in mobile.table("customer_cart_items").rows
            if row["cart_id"] == "cart-1"}
    assert cart["p-1"]["quantity"] == 7      # 5 + 2 upserted
    assert cart["p-3"]["quantity"] == 3      # new row


def test_reorder_foreign_order_404(client):
    web, mobile = make_clients(PRODUCTS, [], ADDRESSES, orders=_order_rows())
    pw, pm, _pcm = patch_clients(web, mobile)
    with pw, pm, _pcm:
        r = client.post("/api/v1/orders/o-X/reorder")
    assert r.status_code == 404
