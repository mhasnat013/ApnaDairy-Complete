from dotenv import load_dotenv

load_dotenv()

"""ApnaDairy B2C API — FastAPI app factory."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router


def create_app() -> FastAPI:
    app = FastAPI(title="ApnaDairy B2C API", version="1.0.0")
    # CORS: restricted to known ApnaDairy origins (production-safe).
    # The API authenticates via Authorization: Bearer <token>, not cookies,
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
    app.include_router(api_router, prefix="/api/v1")

    @app.get("/health", tags=["meta"])
    def health():
        return {"status": "ok"}

    return app


app = create_app()
