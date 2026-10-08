"""Home + chatbot module tests.

Supabase clients are mocked; no network calls.

NOTE: test_03/test_04 set a module-level dependency_overrides entry for
get_current_customer that leaks globally, so this module clears it in an
autouse fixture to test real 401 behavior.
"""
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.deps import get_current_customer
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _no_leaked_auth_override():
    app.dependency_overrides.pop(get_current_customer, None)
    yield
    app.dependency_overrides.pop(get_current_customer, None)


def _guest_feed():
    with patch(
        "app.services.home_service.marketplace_service.list_products",
        return_value={"items": []},
    ), patch("app.services.home_service.get_mobile_client"):
        return client.get("/api/v1/home/feed/")


def test_home_feed_public_ok():
    r = _guest_feed()
    assert r.status_code == 200
    body = r.json()
    assert "greeting" in body
    assert body["is_verified"] is False
    assert body["customer_name"] is None


def test_home_feed_me_requires_auth():
    r = client.get("/api/v1/home/feed/me")
    assert r.status_code == 401


def test_chat_guest_gets_demo_reply():
    r = client.post("/api/v1/chat/", json={"message": "doodh taza hai?"})
    assert r.status_code == 200
    body = r.json()
    assert body["demo"] is True
    assert len(body["reply"]) > 0


def test_chat_rejects_empty_message():
    r = client.post("/api/v1/chat/", json={"message": ""})
    assert r.status_code == 422


def test_chat_service_demo_without_key(monkeypatch):
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    from app.services import chatbot_service as svc

    out = svc.chat_reply("hello")
    assert out["demo"] is True
    assert "demo" in out["reply"].lower()
