from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "Ad-Wise API"
    APP_ENV: str
    PORT: int
    DATABASE_URL: str
    CORS_ALLOWED_ORIGINS: List[str]
    CORS_ALLOWED_REGEX: str

    model_config = SettingsConfigDict(
        env_file = ".env-dev",
        extra="ignore"
    )

settings = Settings()