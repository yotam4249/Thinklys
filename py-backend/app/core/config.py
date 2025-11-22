from typing import List
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "Ad-Wise API"
    APP_ENV: str
    PORT: int
    DATABASE_URL: str
    CORS_ALLOWED_ORIGINS: str  # JSON string, will be parsed in main.py
    CORS_ALLOWED_REGEX: str

    # Redis
    REDIS_URL: str = "redis://localhost:6379"

    # JWT
    ACCESS_TOKEN_SECRET: SecretStr
    REFRESH_TOKEN_SECRET: SecretStr
    ACCESS_TOKEN_EXPIRE: int = 15  # minutes
    REFRESH_TOKEN_EXPIRE: int = 30  # days

    model_config = SettingsConfigDict(
        env_file = ".env.dev",
        extra="ignore"
    )

settings = Settings()