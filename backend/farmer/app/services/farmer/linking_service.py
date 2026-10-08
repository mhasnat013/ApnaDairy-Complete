# ApnaDairy — v2 farmer<->manager linking business logic (REAL web schema).
# Farmer picks a city -> browses area managers -> sends a request to ONE.
# Exclusivity (one manager per farmer) is enforced at two levels:
#   1. Service pre-check: an accepted request blocks any new request (409).
#   2. Database: the partial unique index allows only one OPEN
#      (pending/accepted) farmer_requests row per farmer; a 23505 on insert
#      maps to 409 as a race backstop.
# Web tables used (write path — v2: web is primary read+write for linking):
#   farmer_requests(farmer_id -> profiles.id, area_manager_id, note, status,
#                   reason, created_at, answered_at, ended_at)
#   area_managers(id, user_id -> profiles.id, center_name, city, address)
#   profiles(id, full_name, phone)

import datetime

from app.db.supabase_client import first_row, get_web_client, iso, table
from app.schemas.farmer.linking import (
    CityManagerOut,
    LinkedManagerOut,
    ManagerRequestOut,
)

_OPEN_STATUSES = ("pending", "accepted")


class ManagerNotFoundError(KeyError):
    """The requested area manager does not exist (router maps to 404)."""


class DuplicateRequestError(ValueError):
    """The farmer already has an open (pending) request (router maps to 409)."""


class AlreadyLinkedError(ValueError):
    """The farmer already has an accepted request (router maps to 409)."""


class NoPendingRequestError(KeyError):
    """The farmer has no pending request to cancel (router maps to 404)."""


def _now_iso() -> str:
    """Current UTC time as an ISO string (timestamptz-compatible)."""
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _is_unique_violation(exc: Exception) -> bool:
    """Detect a Postgres unique-violation (code 23505) from supabase-py."""
    return getattr(exc, "code", "") == "23505" or "23505" in str(exc)


# Major Pakistani cities shown in the farmer app's city picker, even when no
# area manager is registered there yet. The static list guarantees the picker
# always offers every region; manager_count tells the UI whether to show
# "N manager(s)" or "No managers yet".
PAKISTAN_CITIES = [
    "Abbottabad", "Bahawalpur", "Chakwal", "Dera Ghazi Khan", "Faisalabad",
    "Gilgit", "Gujranwala", "Gujrat", "Hyderabad", "Islamabad", "Jacobabad",
    "Jhelum", "Karachi", "Kasur", "Khairpur", "Khanewal", "Khushab",
    "Khuzdar", "Kohat", "Lahore", "Larkana", "Mardan", "Mianwali",
    "Mirpur Khas", "Multan", "Muzaffarabad", "Nawabshah", "Nowshera", "Okara",
    "Peshawar", "Quetta", "Rahim Yar Khan", "Rawalpindi", "Sahiwal",
    "Sargodha", "Sialkot", "Sukkur", "Swat", "Turbat", "Vehari",
]


def list_cities() -> list[dict]:
    """Return every major Pakistani city with its area-manager count.

    Cities WITH managers come first (highest count first), then the rest
    alphabetically. Matching against area_managers.city is case-insensitive.
    """
    web = get_web_client()
    rows = table(web, "area_managers").select("city").execute().data or []
    counts: dict[str, int] = {}
    for r in rows:
        city = (r.get("city") or "").strip()
        if city:
            key = city.lower()
            counts[key] = counts.get(key, 0) + 1
    result = [
        {"city": name, "manager_count": counts.get(name.lower(), 0)}
        for name in PAKISTAN_CITIES
    ]
    result.sort(key=lambda d: (d["manager_count"] == 0, -d["manager_count"], d["city"]))
    return result


def list_managers_by_city(city: str) -> list[CityManagerOut]:
    """Return area managers in a city (case-insensitive), with person details.

    Manager name/phone come from profiles via area_managers.user_id.
    """
    web = get_web_client()
    wanted = city.strip().lower()
    rows = (
        table(web, "area_managers")
        .select("id,center_name,address,city,user_id")
        .execute()
        .data
        or []
    )
    rows = [r for r in rows if (r.get("city") or "").strip().lower() == wanted]
    rows.sort(key=lambda r: (r.get("center_name") or "").lower())

    user_ids = [r.get("user_id") for r in rows if r.get("user_id")]
    people: dict[str, dict] = {}
    if user_ids:
        prow = (
            table(web, "profiles")
            .select("id,full_name,phone")
            .in_("id", user_ids)
            .execute()
            .data
            or []
        )
        people = {p["id"]: p for p in prow}

    out = []
    for r in rows:
        person = people.get(r.get("user_id") or "", {})
        out.append(
            CityManagerOut(
                id=r["id"],
                center_name=r.get("center_name") or "",
                address=r.get("address"),
                city=r.get("city"),
                manager_name=person.get("full_name")
                or r.get("center_name")
                or "Manager",
                phone=person.get("phone") or "—",
            )
        )
    return out


def _open_request(web, farmer_profile_id: str) -> dict | None:
    """Return the farmer's latest open (pending/accepted) request, if any."""
    return first_row(
        table(web, "farmer_requests")
        .select("id,status")
        .eq("farmer_id", farmer_profile_id)
        .in_("status", list(_OPEN_STATUSES))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )


def _manager_ref(web, area_manager_id: str | None) -> LinkedManagerOut | None:
    """Build the LinkedManagerOut for a request's manager, if it exists."""
    if not area_manager_id:
        return None
    mgr = first_row(
        table(web, "area_managers")
        .select("id,center_name,city")
        .eq("id", area_manager_id)
        .limit(1)
        .execute()
    )
    if mgr is None:
        return None
    return LinkedManagerOut(
        id=mgr["id"],
        center_name=mgr.get("center_name") or "",
        city=mgr.get("city"),
    )


def _to_request_out(row: dict, manager: LinkedManagerOut | None) -> ManagerRequestOut:
    """Shape a farmer_requests row into the API response."""
    return ManagerRequestOut(
        id=row["id"],
        status=row.get("status") or "pending",
        note=row.get("note"),
        reason=row.get("reason"),
        created_at=iso(row.get("created_at")),
        answered_at=iso(row.get("answered_at")),
        ended_at=iso(row.get("ended_at")),
        manager=manager,
    )


def create_manager_request(
    farmer_profile_id: str, area_manager_id: str, note: str | None
) -> ManagerRequestOut:
    """Insert a pending registration request for the farmer.

    farmer_profile_id is the caller's profiles.id (from current_farmer).
    Raises ManagerNotFoundError / AlreadyLinkedError / DuplicateRequestError.
    """
    web = get_web_client()

    mgr = first_row(
        table(web, "area_managers")
        .select("id,center_name,city")
        .eq("id", area_manager_id)
        .limit(1)
        .execute()
    )
    if mgr is None:
        raise ManagerNotFoundError(f"unknown area manager: {area_manager_id}")

    existing = _open_request(web, farmer_profile_id)
    if existing is not None:
        if existing.get("status") == "accepted":
            raise AlreadyLinkedError("You are already registered with a manager.")
        raise DuplicateRequestError("You already have an open registration request.")

    payload = {
        "farmer_id": farmer_profile_id,
        "area_manager_id": area_manager_id,
        "note": (note or "").strip() or None,
        "status": "pending",
        "created_at": _now_iso(),
    }
    try:
        table(web, "farmer_requests").insert(payload).execute()
    except Exception as exc:
        # Race backstop: the partial unique index rejected a second open
        # request inserted between the pre-check and this insert.
        if _is_unique_violation(exc):
            raise DuplicateRequestError(
                "You already have an open registration request."
            ) from exc
        raise
    # Re-read the stored row (insert().execute() return shapes vary; the
    # unique index guarantees this is the row just inserted).
    row = first_row(
        table(web, "farmer_requests")
        .select("*")
        .eq("farmer_id", farmer_profile_id)
        .in_("status", list(_OPEN_STATUSES))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if row is None:
        raise RuntimeError("farmer_requests insert did not persist.")
    return _to_request_out(row, _manager_ref(web, area_manager_id))


def get_latest_request(farmer_profile_id: str) -> ManagerRequestOut | None:
    """Return the farmer's latest request (any status) with manager info."""
    web = get_web_client()
    row = first_row(
        table(web, "farmer_requests")
        .select("*")
        .eq("farmer_id", farmer_profile_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if row is None:
        return None
    return _to_request_out(row, _manager_ref(web, row.get("area_manager_id")))


def cancel_manager_request(farmer_profile_id: str) -> ManagerRequestOut:
    """Cancel the farmer's own pending request (pending -> cancelled)."""
    web = get_web_client()
    row = first_row(
        table(web, "farmer_requests")
        .select("*")
        .eq("farmer_id", farmer_profile_id)
        .eq("status", "pending")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if row is None:
        raise NoPendingRequestError("No pending registration request to cancel.")
    updated = first_row(
        table(web, "farmer_requests")
        .update({"status": "cancelled"})
        .eq("id", row["id"])
        .execute()
    )
    if updated is None:
        raise RuntimeError("farmer_requests cancel returned no row.")
    return _to_request_out(updated, _manager_ref(web, updated.get("area_manager_id")))
