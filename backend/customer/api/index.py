# Vercel serverless entrypoint for the ApnaDairy customer (B2C) API.
# Vercel's Python runtime natively serves ASGI apps - no Mangum adapter needed.
from app.main import app
