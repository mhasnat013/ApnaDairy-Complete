"""Chatbot schemas: dairy-assistant chat request/response."""
from typing import Optional

from pydantic import BaseModel, Field


class ChatIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    order_id: Optional[str] = None


class ChatOut(BaseModel):
    reply: str
    demo: bool = False
