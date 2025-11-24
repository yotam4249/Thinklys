# app/services/ai_cache_service.py
import hashlib
import json
import logging
from typing import Optional, Dict, Any, List
from app.core.redis import get_redis

logger = logging.getLogger(__name__)

# Cache TTLs
QNA_TTL_SECONDS = 7 * 24 * 60 * 60   # 7 days
QUIZ_TTL_SECONDS = 14 * 24 * 60 * 60  # 14 days

# Max ZSET size for popular tracking
MAX_ZSET_SIZE = 5000


def normalize_string(s: str) -> str:
    """Normalize string for caching: trim, lowercase, collapse whitespace."""
    return " ".join(s.strip().split()).lower()


def hash_string(s: str) -> str:
    """Hash a string using SHA1."""
    return hashlib.sha1(s.encode()).hexdigest()


# ---------- Q&A Cache ----------
def _qna_key(normalized_question: str) -> str:
    """Generate cache key for Q&A."""
    return f"ai:cache:qna:{hash_string(normalized_question)}"


async def get_cached_answer(question: str) -> Optional[str]:
    """Get cached answer for a question."""
    nq = normalize_string(question)
    key = _qna_key(nq)
    logger.info(f"[CACHE] GET {key}")
    
    redis_client = await get_redis()
    answer = await redis_client.get(key)
    
    if answer:
        logger.info(f"[CACHE] GET result: HIT ({len(answer)} chars)")
        return answer
    else:
        logger.info("[CACHE] GET result: MISS")
        return None


async def set_cached_answer(question: str, answer: str) -> None:
    """Cache an answer for a question."""
    nq = normalize_string(question)
    key = _qna_key(nq)
    logger.info(f"[CACHE] SET {key} (EX {QNA_TTL_SECONDS}s)")
    
    redis_client = await get_redis()
    await redis_client.setex(key, QNA_TTL_SECONDS, answer)
    await _incr_question(question)
    logger.info("[CACHE] incrQuestion OK")


# ---------- Quiz Cache ----------
def _quiz_key(topic: str, level: str) -> str:
    """Generate cache key for quiz."""
    t = normalize_string(topic)
    l = normalize_string(level)
    return f"ai:cache:quiz:{hash_string(f'{t}|{l}')}"


async def get_cached_quiz(topic: str, level: str) -> Optional[Dict[str, Any]]:
    """Get cached quiz for topic and level."""
    key = _quiz_key(topic, level)
    logger.info(f"[CACHE] GET {key}")
    
    redis_client = await get_redis()
    raw = await redis_client.get(key)
    
    if not raw:
        logger.info("[CACHE] GET result: MISS")
        return None
    
    logger.info(f"[CACHE] GET result: HIT ({len(raw)} chars)")
    
    try:
        return json.loads(raw)
    except json.JSONDecodeError as e:
        logger.error(f"[CACHE] JSON.parse error: {e}")
        return None


async def set_cached_quiz(topic: str, level: str, quiz: Dict[str, Any]) -> None:
    """Cache a quiz for topic and level."""
    key = _quiz_key(topic, level)
    payload = json.dumps(quiz)
    logger.info(f"[CACHE] SET {key} (len {len(payload)}) (EX {QUIZ_TTL_SECONDS}s)")
    
    redis_client = await get_redis()
    await redis_client.setex(key, QUIZ_TTL_SECONDS, payload)
    await _incr_quiz(topic, level)
    logger.info("[CACHE] incrQuiz OK")


# ---------- Popular Tracking ----------
async def _trim_if_needed(key: str) -> None:
    """Trim ZSET if it exceeds max size."""
    try:
        redis_client = await get_redis()
        size = await redis_client.zcard(key)
        if size > MAX_ZSET_SIZE:
            logger.info(f"[POPULAR] Trimming {key} size: {size}")
            await redis_client.zremrangebyrank(key, 0, size - MAX_ZSET_SIZE - 1)
    except Exception as err:
        logger.warning(f"[POPULAR] trim failed for {key}: {err}")


async def _incr_question(question: str) -> None:
    """Increment popularity counter for a question."""
    member = normalize_string(question)[:512]
    if not member:
        return
    logger.info(f"[POPULAR] zincrby questions: {member}")
    
    redis_client = await get_redis()
    await redis_client.zincrby("ai:popular:questions", 1, member)
    await _trim_if_needed("ai:popular:questions")


async def _incr_quiz(topic: str, level: str) -> None:
    """Increment popularity counter for a quiz."""
    t = normalize_string(topic)[:256]
    l = normalize_string(level)[:64]
    if not t or not l:
        return
    member = f"{t}|{l}"
    logger.info(f"[POPULAR] zincrby quizzes: {member}")
    
    redis_client = await get_redis()
    await redis_client.zincrby("ai:popular:quizzes", 1, member)
    await _trim_if_needed("ai:popular:quizzes")

