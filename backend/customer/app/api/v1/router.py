"""Aggregates every feature router under /api/v1."""
from fastapi import APIRouter

from app.api.v1 import (
    addresses,
    auth, verification, home, marketplace, cart, checkout,
    orders, rider, profile, permanent, payments, complaints,
    chatbot, notifications, staff,
)

api_router = APIRouter()
for r in (auth.router, verification.router, home.router, marketplace.router,
          cart.router, checkout.router, orders.router, rider.router,
          profile.router, permanent.router, payments.router,
          complaints.router, chatbot.router, notifications.router,
          addresses.router, staff.router):
    api_router.include_router(r)
