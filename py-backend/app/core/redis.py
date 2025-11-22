# app/core/redis.py
import redis.asyncio as redis
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

# Global Redis connection pool
_redis_client: redis.Redis | None = None


async def get_redis() -> redis.Redis:
    """Get or create Redis client connection."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=10,
        )
        logger.info(f"[REDIS] Connected to {settings.REDIS_URL}")
    return _redis_client


async def close_redis():
    """Close Redis connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        logger.info("[REDIS] Connection closed")

