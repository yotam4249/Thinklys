# rag/core/config.py
from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "RAG Quiz Server"
    APP_ENV: str = "development"
    
    # Kafka Configuration
    KAFKA_BROKERS: str  # Comma-separated list
    KAFKA_CLIENT_ID: str = "rag-server"
    KAFKA_GROUP_ID: str = "rag-quiz-generator"
    KAFKA_SSL: bool = False
    KAFKA_SASL_MECHANISM: str = ""  # Leave empty for no SASL (local Kafka)
    KAFKA_SASL_USERNAME: str = ""  # Leave empty for no SASL
    KAFKA_SASL_PASSWORD: SecretStr = SecretStr("")  # Leave empty for no SASL
    
    # Kafka Topics
    KAFKA_TOPIC_QUIZ_REQUEST: str = "quiz.generate.request"
    KAFKA_TOPIC_QUIZ_RESPONSE: str = "quiz.generate.response"
    KAFKA_TOPIC_QUIZ_COMPLETION: str = "quiz.generate.completion"
    
    # Vector Database
    CHROMA_PERSIST_DIR: str = "./chroma_db"
    
    # AWS S3 (for file downloads)
    AWS_REGION: str = ""
    AWS_ACCESS_KEY_ID: SecretStr = SecretStr("")
    AWS_SECRET_ACCESS_KEY: SecretStr = SecretStr("")
    S3_BUCKET: str = ""
    
    # Embedding Model
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"  # Lightweight, fast model
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


settings = Settings()

