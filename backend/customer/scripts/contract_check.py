#!/usr/bin/env python3
"""Contract check: every endpoint the mobile app calls must exist in the API.

Compares the FastAPI route table against the registry of mobile calls
(built from the module specs). Exits non-zero on mismatch.
"""

import sys

sys.path.insert(0, "/home/hatch/workspace/apnadairy-b2c/backend")

# (method, path) pairs the mobile app is expected to call.
MOBILE_CALLS = [
    # auth
    ("POST", "/api/v1/auth/signup"),
    ("POST", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/otp/send"),
    ("POST", "/api/v1/auth/otp/verify"),
    # profile + verification
    ("GET", "/api/v1/profile/"),
    ("PUT", "/api/v1/profile/"),
    ("POST", "/api/v1/verification/submit"),
    ("GET", "/api/v1/verification/status"),
    ("POST", "/api/v1/verification/documents"),
    # addresses
    ("GET", "/api/v1/customer/addresses/"),
    ("POST", "/api/v1/customer/addresses/"),
    ("PUT", "/api/v1/customer/addresses/{id}"),
    ("DELETE", "/api/v1/customer/addresses/{id}"),
    ("POST", "/api/v1/customer/addresses/{id}/set-default"),
    # marketplace
    ("GET", "/api/v1/marketplace/products/"),
    ("GET", "/api/v1/marketplace/products/{id}"),
    ("GET", "/api/v1/marketplace/wishlist/"),
    ("POST", "/api/v1/marketplace/wishlist/"),
    ("DELETE", "/api/v1/marketplace/wishlist/{product_id}"),
    # cart
    ("GET", "/api/v1/cart/"),
    ("POST", "/api/v1/cart/items"),
    ("PUT", "/api/v1/cart/items/{id}"),
    ("DELETE", "/api/v1/cart/items/{id}"),
    ("DELETE", "/api/v1/cart/"),
    # checkout + orders
    ("POST", "/api/v1/checkout/"),
    ("GET", "/api/v1/orders/"),
    ("GET", "/api/v1/orders/{id}"),
    ("POST", "/api/v1/orders/{id}/cancel"),
    ("POST", "/api/v1/orders/{id}/reorder"),
    # payments
    ("POST", "/api/v1/payments/"),
    ("GET", "/api/v1/payments/history"),
    ("GET", "/api/v1/payments/dues"),
    ("GET", "/api/v1/payments/{id}"),
    # rider / deliveries
    ("GET", "/api/v1/rider/order/{order_id}"),
    ("POST", "/api/v1/rider/deliveries/{id}/message"),
    ("POST", "/api/v1/rider/deliveries/{id}/rate"),
    # complaints
    ("POST", "/api/v1/complaints/"),
    ("GET", "/api/v1/complaints/"),
    ("GET", "/api/v1/complaints/{id}"),
    ("POST", "/api/v1/complaints/{id}/messages"),
    # notifications
    ("GET", "/api/v1/notifications/"),
    ("POST", "/api/v1/notifications/{id}/read"),
    ("POST", "/api/v1/notifications/read-all"),
    ("DELETE", "/api/v1/notifications/{id}"),
    # permanent
    ("POST", "/api/v1/permanent/request"),
    ("GET", "/api/v1/permanent/status"),
    ("POST", "/api/v1/permanent/requests/{id}/pause"),
    ("POST", "/api/v1/permanent/requests/{id}/resume"),
    ("POST", "/api/v1/permanent/requests/{id}/cancel"),
    ("GET", "/api/v1/permanent/ledger"),
    # staff
    ("GET", "/api/v1/staff/orders"),
    ("POST", "/api/v1/staff/orders/{id}/status"),
    ("POST", "/api/v1/staff/orders/{id}/assign-rider"),
    ("GET", "/api/v1/staff/payments"),
    ("POST", "/api/v1/staff/payments/{id}/verify"),
    ("GET", "/api/v1/staff/complaints"),
    ("POST", "/api/v1/staff/complaints/{id}/respond"),
    ("GET", "/api/v1/staff/customers"),
    ("POST", "/api/v1/staff/customers/{id}/verify"),
]


def collect_routes(app) -> set:
    """Expand FastAPI 0.142 deferred _IncludedRouter entries recursively."""
    from fastapi import APIRouter

    seen: set = set()

    def walk(router, prefix=""):
        for r in router.routes:
            t = type(r).__name__
            if t == "APIRoute":
                for m in (r.methods or set()) - {"HEAD", "OPTIONS"}:
                    seen.add((m, prefix + r.path))
            elif t == "_IncludedRouter":
                walk(r.original_router, prefix)
            elif isinstance(r, APIRouter):
                walk(r, prefix)

    for r in app.routes:
        t = type(r).__name__
        if t == "APIRoute":
            for m in (r.methods or set()) - {"HEAD", "OPTIONS"}:
                seen.add((m, r.path))
        elif t == "_IncludedRouter":
            # top-level include used prefix="/api/v1"
            walk(r.original_router, "/api/v1")
    return seen


def main() -> int:
    import os

    os.environ.setdefault("SUPABASE_MOBILE_URL", "https://test.supabase.co")
    os.environ.setdefault("SUPABASE_MOBILE_SERVICE_KEY", "test")
    from app.main import create_app

    app = create_app()
    routes = collect_routes(app)

    def norm(p: str) -> str:
        # turn /foo/{bar} into /foo/{id}-style placeholder-insensitive form
        import re

        return re.sub(r"\{[^}]+\}", "{x}", p.rstrip("/"))

    have = {(m, norm(p)) for m, p in routes}
    missing = [(m, p) for m, p in MOBILE_CALLS if (m, norm(p)) not in have]
    if missing:
        print(f"MISMATCH: {len(missing)} mobile calls have no route:")
        for m, p in missing:
            print(f"  {m} {p}")
        return 1
    print(f"OK: all {len(MOBILE_CALLS)} mobile calls have matching routes.")
    print(f"Total routes in app: {len(have)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
