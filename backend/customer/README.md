# ApnaDairy B2C — Backend (FastAPI + Supabase)

REST API for the customer mobile app. Python/FastAPI talks to Supabase
(Postgres + Auth + Storage). The React Native app calls THESE endpoints —
it never talks to Supabase directly except via the backend
(auth tokens are Supabase JWTs, validated here).

## Run it (Windows)

```bat
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
REM fill .env with the values from CHATGPT-HANDOFF.md §6
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: http://localhost:8000/docs

## Layout

```
backend/
  app/
    main.py            # app factory, CORS, router mount, /health
    core/              # config, security (JWT/OTP), dependencies
    db/                # Supabase client singleton + request session
    models/            # table reference per feature (DDL lives in db_schema/)
    schemas/           # Pydantic request/response models per feature
    api/v1/            # REST routers per feature (auth, verification, home …)
    services/          # business logic per feature (calls Supabase)
    utils/             # otp, validators (PK phone, CNIC)
  db_schema/           # SQL run in Supabase SQL Editor, in order:
                       # 01_tables → 02_rls → 03_storage → 04_triggers
  seed/
    seed.sql           # demo data for the supervisor demo
```

## Scope

B2C ONLY. No B2B routers, services, or tables.
