"""/chat — AI chatbot proxy → Groq (llama-3.3-70b-versatile), dairy-only system prompt."""
from typing import Optional

from fastapi import APIRouter, HTTPException, Request

from app.core.deps import get_current_customer
from app.schemas import chatbot as schemas
from app.services import chatbot_service as svc

router = APIRouter(prefix="/chat", tags=["chatbot"])


@router.post("/", response_model=schemas.ChatOut)
def chat(body: schemas.ChatIn, request: Request):
    """Ask the dairy assistant. Auth optional — guests get generic answers."""
    customer_id: Optional[str] = None
    try:
        customer_id = get_current_customer(request)
    except HTTPException:
        customer_id = None  # guest mode: no order context
    return svc.chat_reply(body.message, customer_id, body.order_id)
