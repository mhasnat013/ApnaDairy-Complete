"""Home feed schemas: greeting, featured batches, managers, value picks."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel


class HomeFeedOut(BaseModel):
    greeting: str
    customer_name: Optional[str] = None
    is_verified: bool = False
    featured: List[Dict[str, Any]] = []
    nearby_managers: List[Dict[str, Any]] = []
    value_picks: List[Dict[str, Any]] = []
    pending_dues: float = 0.0
    unread_notifications: int = 0
