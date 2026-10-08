# Vercel serverless entrypoint for the ApnaDairy farmer API.
# Vercel's Python runtime natively serves ASGI apps — no Mangum adapter needed.
# Local development still uses uvicorn directly.
from app.main import app
