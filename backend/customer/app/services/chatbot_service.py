"""AI chatbot service: dairy-assistant proxy via Groq (llama-3.3-70b-versatile).

When GROQ_API_KEY is not configured, raises 503 (no demo/fake replies —
project rule). Never invents order data — order-aware answers only use real
rows from the mobile project.
"""
import os
from typing import Any, Dict, Optional

import httpx
from fastapi import HTTPException

SYSTEM_PROMPT = (
    "You are the ApnaDairy customer assistant, a helpful dairy-shop helper for "
    "a Pakistani milk delivery app. Always answer in formal, professional "
    "English. Keep answers short and practical: milk freshness, orders, "
    "deliveries, payments, complaints. Never invent order numbers, prices, or "
    "account details — if asked about the user's own data, say you can only "
    "see what the app shows and suggest checking the Orders tab."
)


def _order_context(customer_id: Optional[str], order_id: Optional[str]) -> str:
    if not customer_id or not order_id:
        return ""
    try:
        from app.db.supabase_client import get_mobile_client

        client = get_mobile_client()
        r = (
            client.table("customer_orders")
            .select("id,status,total_amount,created_at")
            .eq("id", order_id)
            .eq("customer_id", customer_id)
            .limit(1)
            .execute()
        )
        if r.data:
            o = r.data[0]
            return f"\nUser's order context: id={o['id']}, status={o['status']}, total={o['total_amount']}."
    except Exception:
        pass
    return ""


def chat_reply(
    message: str, customer_id: Optional[str] = None, order_id: Optional[str] = None
) -> Dict[str, Any]:
    api_key = os.environ.get("GROQ_API_KEY", "")
    context = _order_context(customer_id, order_id)
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="AI assistant is currently unavailable. Please try again later.",
        )
    try:
        resp = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "llama-3.3-70b-versatile",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT + context},
                    {"role": "user", "content": message},
                ],
                "max_tokens": 400,
                "temperature": 0.6,
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        reply = data["choices"][0]["message"]["content"].strip()
        return {"reply": reply, "demo": False}
    except Exception:
        return {
            "reply": (
                "Sorry — the assistant could not be reached. Please try again "
                "or check your order in the Orders tab."
            ),
            "demo": True,
        }
