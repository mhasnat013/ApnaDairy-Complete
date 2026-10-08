"""Settings loaded from .env (pydantic-settings)."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str
    groq_api_key: str = ""
    jwt_secret: str = "change-me"
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()
