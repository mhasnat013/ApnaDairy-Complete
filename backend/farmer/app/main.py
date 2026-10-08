# ApnaDairy — Farmer Dashboard Backend (FastAPI)
# Entry point: creates the FastAPI app and mounts the farmer dashboard router.
# No secrets, no real DB connection — service layer returns demo data for now.

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Load backend/.env (real Supabase keys) before anything reads os.environ.
from dotenv import load_dotenv

load_dotenv()

from app.api.v1.farmer.dashboard import router as farmer_dashboard_router
from app.api.v1.farmer import profile as farmer_profile
from app.api.v1.farmer import documents as farmer_documents
from app.api.v1.farmer import verification as farmer_verification
from app.api.v1.farmer import onboarding as farmer_onboarding
from app.api.v1.farmer import sales as farmer_sales
from app.api.v1.farmer.payments import router as farmer_payments_router
from app.api.v1.farmer.notifications import router as farmer_notifications_router
from app.api.v1.farmer.complaints import router as farmer_complaints_router
from app.api.v1.farmer.managers import router as farmer_managers_router
from app.api.v1.farmer.assistant import router as farmer_assistant_router
from app.api.v1.auth import router as demo_auth_router


def create_app() -> FastAPI:
    """Build and configure the FastAPI application instance."""
    app = FastAPI(
        title="ApnaDairy Farmer Dashboard API",
        version="0.1.0",
        description="Farmer dashboard endpoints for the ApnaDairy mobile app.",
    )
    # CORS: restricted to known ApnaDairy origins (production-safe).
    # The API authenticates via Authorization: Bearer headers, not cookies,
    # so credentials are not needed.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "https://apna-dairy-complete.vercel.app",
            "https://apnadairy-psi.vercel.app",
            "http://localhost:5173",
            "http://localhost:8081",
        ],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    # Mount all farmer routers (all routes live under /api/v1/farmer, except
    # the manager-side linking routes under /api/v1/manager).
    app.include_router(farmer_dashboard_router)
    app.include_router(farmer_profile.router)
    app.include_router(farmer_documents.router)
    app.include_router(farmer_verification.router)
    app.include_router(farmer_onboarding.router)
    app.include_router(farmer_sales.router)
    app.include_router(farmer_payments_router)
    app.include_router(farmer_notifications_router)
    app.include_router(farmer_complaints_router)
    app.include_router(farmer_managers_router)
    app.include_router(farmer_assistant_router)
    app.include_router(demo_auth_router)
    return app


app = create_app()


@app.exception_handler(RuntimeError)
async def _runtime_error_handler(request, exc: RuntimeError):
    """Turn config errors (e.g. missing SUPABASE_URL) into clean 503 JSON."""
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.get("/health", tags=["system"])
def health_check() -> dict:
    """Simple liveness probe for monitoring and smoke tests."""
    return {"status": "ok"}
