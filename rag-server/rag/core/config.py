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
    CHROMA_DISTANCE_METRIC: str = "cosine"  # Distance metric: cosine, l2, or ip (inner product)
    
    # AWS S3 (for file downloads)
    AWS_REGION: str = ""
    AWS_ACCESS_KEY_ID: SecretStr = SecretStr("")
    AWS_SECRET_ACCESS_KEY: SecretStr = SecretStr("")
    S3_BUCKET: str = ""
    
    # Embedding Model
    EMBEDDING_MODEL: str = "all-MiniLM-L6-v2"  # Lightweight, fast model
    
    # Text Chunking Configuration
    # all-MiniLM-L6-v2 works best with ~256 tokens ≈ 1000 characters
    TEXT_CHUNK_SIZE: int = 1000  # Target chunk size in characters (~250 tokens)
    TEXT_CHUNK_OVERLAP: int = 200  # Overlap size in characters (20% of chunk_size)
    
    # OpenAI Configuration (for LangChain RAG)
    OPENAI_API_KEY: SecretStr = SecretStr("")
    OPENAI_MODEL: str = "gpt-4o-mini"  # Cheapest model: $0.15/$0.60 per 1M tokens
    OPENAI_TEMPERATURE: float = 0.7
    
    # Cost Optimization
    QUIZ_CACHE_TTL: int = 3600  # Cache quiz results for 1 hour
    
    # Generator Selection
    USE_LANGCHAIN_GENERATOR: bool = True  # Use LangChain RAG (True) or pattern-based (False)
    
    # MCP (Model Context Protocol) Configuration
    ENABLE_MCP: bool = False  # Enable external knowledge sources (Wikipedia, GitHub)
    ENABLE_WIKIPEDIA: bool = True  # Enable Wikipedia enrichment
    ENABLE_GITHUB: bool = True  # Enable GitHub enrichment
    GITHUB_TOKEN: SecretStr = SecretStr("")  # Optional: GitHub token for higher rate limits

    # Internal HTTP API (used by py-backend /api/agent/* endpoints)
    RAG_HTTP_HOST: str = "127.0.0.1"
    RAG_HTTP_PORT: int = 9001
    RAG_INTERNAL_SECRET: SecretStr  # Required; gates all /internal/* endpoints
    
    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )


settings = Settings()

