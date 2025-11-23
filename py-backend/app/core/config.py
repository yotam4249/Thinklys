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

    # AWS S3
    AWS_REGION: str
    AWS_ACCESS_KEY_ID: SecretStr
    AWS_SECRET_ACCESS_KEY: SecretStr
    S3_BUCKET: str
    S3_URL_TTL_SECONDS: int = 900  # 15 minutes default

    # Kafka Configuration
    KAFKA_BROKERS: str = ""  # Comma-separated list
    KAFKA_CLIENT_ID: str = "py-backend"
    KAFKA_SSL: bool = False
    KAFKA_SASL_MECHANISM: str = ""
    KAFKA_SASL_USERNAME: str = ""
    KAFKA_SASL_PASSWORD: SecretStr = SecretStr("")
    
    # Kafka Topics
    KAFKA_TOPIC_QUIZ_REQUEST: str = "quiz.generate.request"
    KAFKA_TOPIC_QUIZ_RESPONSE: str = "quiz.generate.response"

    model_config = SettingsConfigDict(
        env_file = ".env.dev",
        extra="ignore"
    )

settings = Settings()