"""Marketplace module tests (worker 5).

Supabase clients are fully mocked: get_web_client / get_mobile_client in
app.services.marketplace_service are patched with chainable recording
builders. No network calls.
"""
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import app.services.marketplace_service as svc
from app.core.deps import get_current_customer
from app.main import app

TODAY = date.today()
EXP = (TODAY + timedelta(days=5)).isoformat()

PRODUCT_A = {
    "id": "prod-1",
    "area_manager_id": "mgr-1",
    "name": "Fresh Cow Milk",
    "category": "milk",
    "milk_type": "cow",
    "unit": "L",
    "price": 240,
    "discount_pct": 10,
    "stock_qty": 50,
    "made_on": TODAY.isoformat(),
    "expires_on": EXP,
    "is_available": True,
    "is_sample": False,
    "description": "Pure cow milk",
    "created_at": "2026-10-01T00:00:00",
}
PRODUCT_B = {
    "id": "prod-2",
    "area_manager_id": "mgr-2",
    "name": "Desi Ghee",
    "category": "byproduct",
    "milk_type": None,
    "unit": "kg",
    "price": 2500,
    "discount_pct": 0,
    "stock_qty": 10,
    "made_on": TODAY.isoformat(),
    "expires_on": None,
    "is_available": True,
    "is_sample": False,
    "description": "Desi ghee",
    "created_at": "2026-10-02T00:00:00",
}
MANAGERS = [
    {"id": "mgr-1", "center_name": "Farooq and Sons", "city": "Islamabad"},
    {"id": "mgr-2", "center_name": "Lahore Dairy", "city": "Lahore"},
]


class ChainBuilder:
    """Records every builder call; .execute() returns canned rows."""

    def __init__(self, data, count=None):
        self._data = data
        self._count = count
        self.calls = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name == "execute":
            return lambda: SimpleNamespace(data=self._data, count=self._count)

        def _call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return _call


def _clients(products=None, managers=None, product_count=None, wishlist=None):
    """Build (web_mock, mobile_mock, builders) with table() side effects."""
    products = products if products is not None else [PRODUCT_A, PRODUCT_B]
    managers = managers if managers is not None else MANAGERS
    wishlist = wishlist if wishlist is not None else []

    builders = {}

    def web_table(name):
        key = ("web", name)
        if key not in builders:
            if name == "products":
                builders[key] = ChainBuilder(list(products), count=product_count)
            else:
                builders[key] = ChainBuilder(list(managers))
        return builders[key]

    def mobile_table(name):
        key = ("mobile", name)
        if key not in builders:
            builders[key] = ChainBuilder(list(wishlist))
        return builders[key]

    web = SimpleNamespace(table=web_table)
    mobile = SimpleNamespace(table=mobile_table)
    return web, mobile, builders


def _raise_401():
    raise HTTPException(status_code=401, detail="Not authenticated.")


@pytest.fixture()
def authed():
    app.dependency_overrides[get_current_customer] = lambda: "cust-1"
    yield
    app.dependency_overrides.pop(get_current_customer, None)


@pytest.fixture()
def client():
    return TestClient(app)


def _patch(web, mobile):
    return (
        patch.object(svc, "get_web_client", return_value=web),
        patch.object(svc, "get_mobile_client", return_value=mobile),
    )


# ---------- list: filters / sort / pagination ----------


def test_list_products_filters_sort_pagination(client):
    web, mobile, builders = _clients(product_count=2)
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get(
            "/api/v1/marketplace/products/",
            params={
                "category": "milk",
                "milk_type": "cow",
                "q": "cow",
                "sort": "price_asc",
                "page": 2,
                "page_size": 10,
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert body["page"] == 2 and body["page_size"] == 10 and body["total"] == 2
    assert len(body["items"]) == 2

    b = builders[("web", "products")]
    eqs = [(c[1][0], c[1][1]) for c in b.calls if c[0] == "eq"]
    assert ("is_available", True) in eqs
    assert ("is_sample", False) in eqs
    assert ("category", "milk") in eqs
    assert ("milk_type", "cow") in eqs
    gts = [(c[1][0], c[1][1]) for c in b.calls if c[0] == "gt"]
    assert ("stock_qty", 0) in gts
    ors = [c for c in b.calls if c[0] == "or_"]
    assert ors and "name.ilike.%cow%" in ors[0][1][0]
    orders = [c for c in b.calls if c[0] == "order"]
    assert orders[0][1][0] == "price" and orders[0][2].get("desc") is not True
    ranges = [c for c in b.calls if c[0] == "range"]
    assert ranges[0][1] == (10, 19)  # page 2, size 10 -> rows 10..19

    item = body["items"][0]
    assert item["id"] == "prod-1"
    assert item["final_price"] == 216.0  # 240 * 0.9
    assert item["freshness_days"] == 5
    assert item["manager"] == {
        "id": "mgr-1",
        "center_name": "Farooq and Sons",
        "city": "Islamabad",
    }


def test_list_default_sort_newest_desc(client):
    web, mobile, builders = _clients()
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/")
    assert r.status_code == 200
    orders = [c for c in builders[("web", "products")].calls if c[0] == "order"]
    assert orders[0][1][0] == "created_at" and orders[0][2].get("desc") is True


def test_list_city_filter_queries_managers_first(client):
    web, mobile, builders = _clients()
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/", params={"city": "Islamabad"})
    assert r.status_code == 200
    mgr_builder = builders[("web", "area_managers")]
    eqs = [(c[1][0], c[1][1]) for c in mgr_builder.calls if c[0] == "eq"]
    assert ("city", "Islamabad") in eqs
    in_calls = [c for c in builders[("web", "products")].calls if c[0] == "in_"]
    assert in_calls and in_calls[0][1][0] == "area_manager_id"


def test_list_city_with_no_managers_returns_empty(client):
    web, mobile, _ = _clients(managers=[])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/", params={"city": "Nowhere"})
    assert r.status_code == 200
    assert r.json() == {"items": [], "page": 1, "page_size": 20, "total": 0}


def test_list_excludes_unavailable_sample_zero_stock(client):
    bad = [
        {**PRODUCT_A, "id": "x1", "is_available": False},
        {**PRODUCT_A, "id": "x2", "is_sample": True},
        {**PRODUCT_A, "id": "x3", "stock_qty": 0},
        PRODUCT_A,
    ]
    web, mobile, _ = _clients(products=bad)
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/")
    assert r.status_code == 200
    ids = [i["id"] for i in r.json()["items"]]
    assert ids == ["prod-1"]


def test_list_invalid_sort_400(client):
    web, mobile, _ = _clients()
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/", params={"sort": "bogus"})
    assert r.status_code == 400
    assert "detail" in r.json()


# ---------- detail ----------


def test_product_detail_ok(client):
    web, mobile, _ = _clients()
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/prod-1")
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Fresh Cow Milk"
    assert body["final_price"] == 216.0
    assert body["manager"]["city"] == "Islamabad"


def test_product_detail_404_missing(client):
    web, mobile, _ = _clients(products=[])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Product not found."}


def test_product_detail_404_unavailable(client):
    web, mobile, _ = _clients(products=[{**PRODUCT_A, "is_available": False}])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/products/prod-1")
    assert r.status_code == 404


# ---------- wishlist ----------


def test_wishlist_requires_auth(client):
    app.dependency_overrides[get_current_customer] = _raise_401
    try:
        web, mobile, _ = _clients()
        pw, pm = _patch(web, mobile)
        with pw, pm:
            assert client.get("/api/v1/marketplace/wishlist/").status_code == 401
            assert (
                client.post(
                    "/api/v1/marketplace/wishlist/", json={"product_id": "prod-1"}
                ).status_code
                == 401
            )
            assert client.delete("/api/v1/marketplace/wishlist/prod-1").status_code == 401
    finally:
        app.dependency_overrides.pop(get_current_customer, None)


def test_wishlist_add_creates(client, authed):
    web, mobile, builders = _clients(wishlist=[])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/marketplace/wishlist/", json={"product_id": "prod-1"})
    assert r.status_code == 200
    body = r.json()
    assert body["product_id"] == "prod-1"
    assert body["product"]["final_price"] == 216.0
    inserts = [
        c for c in builders[("mobile", "customer_wishlist_items")].calls if c[0] == "insert"
    ]
    assert len(inserts) == 1
    assert inserts[0][1][0]["customer_id"] == "cust-1"
    assert inserts[0][1][0]["product_id"] == "prod-1"


def test_wishlist_add_idempotent(client, authed):
    web, mobile, builders = _clients(wishlist=[{"product_id": "prod-1"}])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/marketplace/wishlist/", json={"product_id": "prod-1"})
    assert r.status_code == 200
    assert r.json()["product_id"] == "prod-1"
    inserts = [
        c for c in builders[("mobile", "customer_wishlist_items")].calls if c[0] == "insert"
    ]
    assert inserts == []  # already existed -> no duplicate insert


def test_wishlist_add_missing_product_404(client, authed):
    web, mobile, _ = _clients(products=[])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.post("/api/v1/marketplace/wishlist/", json={"product_id": "nope"})
    assert r.status_code == 404
    assert r.json() == {"detail": "Product not found."}


def test_wishlist_list_enriched(client, authed):
    web, mobile, _ = _clients(wishlist=[{"product_id": "prod-1"}])
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.get("/api/v1/marketplace/wishlist/")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["product_id"] == "prod-1"
    assert items[0]["product"]["name"] == "Fresh Cow Milk"


def test_wishlist_delete(client, authed):
    web, mobile, builders = _clients()
    pw, pm = _patch(web, mobile)
    with pw, pm:
        r = client.delete("/api/v1/marketplace/wishlist/prod-1")
    assert r.status_code == 204
    deletes = [
        c for c in builders[("mobile", "customer_wishlist_items")].calls if c[0] == "delete"
    ]
    assert len(deletes) == 1
    eqs = [
        (c[1][0], c[1][1])
        for c in builders[("mobile", "customer_wishlist_items")].calls
        if c[0] == "eq"
    ]
    assert ("customer_id", "cust-1") in eqs
    assert ("product_id", "prod-1") in eqs
