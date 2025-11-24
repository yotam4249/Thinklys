# app/api/routes/quiz_routes.py
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import Dict, Any, Optional
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.middleware.auth_middleware import get_current_user
from app.services.kafka_service import kafka_service, new_request_id
from app.services.openai_service import generate_openai_quiz, generate_openai_quiz_strict
from app.services.ai_cache_service import get_cached_quiz, set_cached_quiz
from app.utils.quiz_utils import coerce_quiz_shape, is_valid_quiz_shape
from app.core.config import settings
from app.core.redis import get_redis
from app.core.db import get_db
from app.api.dto.quiz_dto import (
    QuizGenerateRequestDTO,
    QuizGenerateResponseDTO,
    QuizResponseDTO,
    QuizItemDTO,
    QuizResultSaveDTO,
    QuizResultSaveResponseDTO,
    QuizHistoryItemDTO,
)
from app.models.quiz_result import QuizResult
from app.models.user import User
import json
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["quiz"])

# Store pending requests (in production, use Redis or database)
pending_requests: Dict[str, asyncio.Future] = {}


async def wait_for_quiz_response(request_id: str, timeout: int = 60) -> Optional[Dict[str, Any]]:
    """Wait for quiz response from RAG server via Kafka."""
    # Create a future for this request
    loop = asyncio.get_event_loop()
    future = loop.create_future()
    pending_requests[request_id] = future
    
    try:
        # Wait for response with timeout
        result = await asyncio.wait_for(future, timeout=timeout)
        return result
    except asyncio.TimeoutError:
        logger.error(f"Timeout waiting for quiz response: {request_id}")
        return None
    finally:
        pending_requests.pop(request_id, None)


def process_quiz_response(message: Dict[str, Any]):
    """Process quiz response from Kafka consumer."""
    print(f"[KAFKA-RESPONSE] 📨 Received quiz response from RAG server")
    print(f"[KAFKA-RESPONSE] Message: {json.dumps(message, indent=2)}")
    
    request_id = message.get("requestId")
    if not request_id:
        print("[KAFKA-RESPONSE] ❌ No requestId in message, ignoring")
        return
    
    print(f"[KAFKA-RESPONSE] Looking for pending request: {request_id}")
    future = pending_requests.get(request_id)
    if future and not future.done():
        future.set_result(message)
        print(f"[KAFKA-RESPONSE] ✅ Quiz response received and set for requestId: {request_id}")
        logger.info(f"Quiz response received and set: {request_id}")
    else:
        print(f"[KAFKA-RESPONSE] ⚠️ No pending request found for requestId: {request_id}")


@router.post("/quiz", response_model=QuizGenerateResponseDTO)
async def generate_quiz(
    dto: QuizGenerateRequestDTO,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """
    Generate a quiz.
    - If files are provided: uses RAG server via Kafka
    - If no files: uses OpenAI directly with caching
    """
    topic = dto.topic.strip() if dto.topic else ""
    level = dto.level.strip() if dto.level else ""
    
    logger.info(f"[QUIZ] Incoming: topic={topic}, level={level}, has_files={bool(dto.files and len(dto.files) > 0)}")
    
    # Validate input
    if not topic:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Topic is required"}
        )
    
    if not level:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Level is required"}
        )
    
    # Check if files are provided - if yes, use RAG (Kafka), otherwise use OpenAI
    has_files = dto.files and len(dto.files) > 0
    
    if has_files:
        # Use RAG server via Kafka (existing logic)
        return await _generate_quiz_via_rag(dto, topic, level)
    else:
        # Use OpenAI directly (new logic)
        return await _generate_quiz_via_openai(topic, level)


async def _generate_quiz_via_rag(
    dto: QuizGenerateRequestDTO,
    topic: str,
    level: str
) -> QuizGenerateResponseDTO:
    """Generate quiz using RAG server via Kafka."""
    # Check cache first (include files in cache key)
    redis_client = await get_redis()
    files_hash = ""
    if dto.files and len(dto.files) > 0:
        import hashlib
        files_str = ",".join(sorted(dto.files))
        files_hash = hashlib.md5(files_str.encode()).hexdigest()[:8]
    cache_key = f"quiz:{topic}:{level}:{files_hash}" if files_hash else f"quiz:{topic}:{level}"
    cached = await redis_client.get(cache_key)
    
    if cached:
        try:
            quiz_data = json.loads(cached)
            logger.info(f"Quiz cache hit: {topic}:{level}")
            return QuizGenerateResponseDTO(
                success=True,
                quiz=QuizResponseDTO(**quiz_data),
                cached=True
            )
        except Exception as e:
            logger.warning(f"Error parsing cached quiz: {e}")
    
    # Generate request ID
    request_id = new_request_id()
    
    # Prepare Kafka message
    kafka_message = {
        "requestId": request_id,
        "topic": topic,
        "level": level,
        "files": dto.files or [],
        "fileTypes": dto.fileTypes or [],
    }
    
    # Publish to Kafka
    success = kafka_service.publish(
        settings.KAFKA_TOPIC_QUIZ_REQUEST,
        kafka_message,
        key=request_id
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "KAFKA_UNAVAILABLE", "message": "Quiz generation service unavailable"}
        )
    
    logger.info(f"Quiz request published: {request_id}")
    
    # Wait for response (with timeout)
    response = await wait_for_quiz_response(request_id, timeout=60)
    
    if not response:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail={"code": "TIMEOUT", "message": "Quiz generation timed out"}
        )
    
    if not response.get("success"):
        error = response.get("error", "Unknown error")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "QUIZ_GENERATION_ERROR", "message": error}
        )
    
    # Parse quiz response
    quiz_data = response.get("quiz")
    if not quiz_data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INVALID_RESPONSE", "message": "Invalid quiz response"}
        )
    
    # Cache the result
    try:
        await redis_client.setex(
            cache_key,
            3600,  # 1 hour cache
            json.dumps(quiz_data)
        )
    except Exception as e:
        logger.warning(f"Error caching quiz: {e}")
    
    # Convert to response DTO
    quiz_items = [
        QuizItemDTO(**item) for item in quiz_data.get("items", [])
    ]
    
    quiz_response = QuizResponseDTO(
        topic=quiz_data.get("topic", topic),
        level=quiz_data.get("level", level),
        items=quiz_items
    )
    
    return QuizGenerateResponseDTO(
        success=True,
        quiz=quiz_response,
        cached=False
    )


async def _generate_quiz_via_openai(
    topic: str,
    level: str
) -> QuizGenerateResponseDTO:
    """Generate quiz using OpenAI directly with caching."""
    try:
        # 1) Cache lookup
        cached = await get_cached_quiz(topic, level)
        if cached:
            logger.info("[QUIZ] Cache HIT → returning cached quiz")
            return QuizGenerateResponseDTO(
                success=True,
                quiz=QuizResponseDTO(**cached),
                cached=True
            )
        
        logger.info("[QUIZ] Cache MISS → calling OpenAI (normal)")
        
        # 2) Attempt 1 (normal)
        json_str = await generate_openai_quiz(topic, level)
        logger.info(f"[QUIZ] OpenAI (normal) JSON len: {len(json_str) if json_str else 0}")
        
        parsed = None
        try:
            parsed = json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.error(f"[QUIZ] JSON.parse failed (normal): {e}")
        
        if parsed:
            parsed = coerce_quiz_shape(parsed)
        
        if not parsed or not is_valid_quiz_shape(parsed):
            logger.warning("[QUIZ] Shape invalid after normal attempt; retry STRICT")
            # 3) Attempt 2 (strict)
            strict_str = await generate_openai_quiz_strict(topic, level)
            logger.info(f"[QUIZ] OpenAI (strict) JSON len: {len(strict_str) if strict_str else 0}")
            
            try:
                parsed = json.loads(strict_str)
            except json.JSONDecodeError as e:
                logger.error(f"[QUIZ] JSON.parse failed (strict): {e}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={"error": "openai_bad_json"}
                )
            
            parsed = coerce_quiz_shape(parsed)
            
            ok2 = is_valid_quiz_shape(parsed)
            logger.info(f"[QUIZ] strict shape valid? {ok2}")
            if not ok2:
                logger.error(f"[QUIZ] Shape invalid after strict retry; sample: {json.dumps(parsed)[:400] if parsed else 'None'}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail={"error": "openai_shape_invalid", "data": parsed}
                )
        
        # 4) Save & return
        await set_cached_quiz(topic, level, parsed)
        logger.info("[QUIZ] Saved to cache OK")
        
        # Convert to response DTO
        quiz_items = [
            QuizItemDTO(**item) for item in parsed.get("items", [])
        ]
        
        quiz_response = QuizResponseDTO(
            topic=parsed.get("topic", topic),
            level=parsed.get("level", level),
            items=quiz_items
        )
        
        return QuizGenerateResponseDTO(
            success=True,
            quiz=quiz_response,
            cached=False
        )
        
    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"[QUIZ] Error: {err}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "server_error", "detail": str(err)}
        )


def process_quiz_completion(message: Dict[str, Any]):
    """Process quiz completion notification from RAG server."""
    print(f"[KAFKA-COMPLETION] 📨 Received quiz completion notification from RAG server")
    print(f"[KAFKA-COMPLETION] Message: {json.dumps(message, indent=2)}")
    
    request_id = message.get("requestId")
    status = message.get("status", "unknown")
    completion_message = message.get("message", "")
    
    if not request_id:
        print("[KAFKA-COMPLETION] ❌ No requestId in completion message, ignoring")
        return
    
    logger.info(f"Quiz completion notification: requestId={request_id}, status={status}, message={completion_message}")
    print(f"[KAFKA-COMPLETION] ✅ Quiz completion processed: requestId={request_id}, status={status}")


# Start Kafka consumer for quiz responses in background
async def start_quiz_response_consumer():
    """Start consuming quiz responses and completion notifications from Kafka."""
    print(f"[KAFKA-RESPONSE] 🎧 Starting quiz response consumer...")
    print(f"[KAFKA-RESPONSE]   Topic: {settings.KAFKA_TOPIC_QUIZ_RESPONSE}")
    print(f"[KAFKA-RESPONSE]   Group ID: {settings.KAFKA_CLIENT_ID}-quiz-response")
    
    if not settings.KAFKA_BROKERS:
        print("[KAFKA-RESPONSE] ❌ Kafka not configured, quiz response consumer disabled")
        logger.warning("Kafka not configured, quiz response consumer disabled")
        return
    
    consumer = kafka_service.create_consumer(
        topics=[settings.KAFKA_TOPIC_QUIZ_RESPONSE],
        group_id=f"{settings.KAFKA_CLIENT_ID}-quiz-response",
        message_handler=process_quiz_response
    )
    
    if consumer:
        # Run consumer in background
        def consume_loop():
            try:
                print("[KAFKA-RESPONSE] 🎧 Consumer loop started, waiting for messages...")
                for message in consumer:
                    print(f"[KAFKA-RESPONSE] 📨 Raw message received from Kafka")
                    print(f"[KAFKA-RESPONSE]   Topic: {message.topic}, Partition: {message.partition}, Offset: {message.offset}")
                    process_quiz_response(message.value)
            except Exception as e:
                print(f"[KAFKA-RESPONSE] ❌ Error in quiz response consumer: {e}")
                logger.error(f"Error in quiz response consumer: {e}", exc_info=True)
        
        import threading
        thread = threading.Thread(target=consume_loop, daemon=True)
        thread.start()
        print("[KAFKA-RESPONSE] ✅ Quiz response consumer started in background thread")
        logger.info("Quiz response consumer started")
    else:
        print("[KAFKA-RESPONSE] ❌ Failed to create consumer")
    
    # Start completion notification consumer
    print(f"[KAFKA-COMPLETION] 🎧 Starting quiz completion consumer...")
    print(f"[KAFKA-COMPLETION]   Topic: {settings.KAFKA_TOPIC_QUIZ_COMPLETION}")
    print(f"[KAFKA-COMPLETION]   Group ID: {settings.KAFKA_CLIENT_ID}-quiz-completion")
    
    completion_consumer = kafka_service.create_consumer(
        topics=[settings.KAFKA_TOPIC_QUIZ_COMPLETION],
        group_id=f"{settings.KAFKA_CLIENT_ID}-quiz-completion",
        message_handler=process_quiz_completion
    )
    
    if completion_consumer:
        def completion_loop():
            try:
                print("[KAFKA-COMPLETION] 🎧 Completion consumer loop started, waiting for messages...")
                for message in completion_consumer:
                    print(f"[KAFKA-COMPLETION] 📨 Raw completion message received from Kafka")
                    print(f"[KAFKA-COMPLETION]   Topic: {message.topic}, Partition: {message.partition}, Offset: {message.offset}")
                    process_quiz_completion(message.value)
            except Exception as e:
                print(f"[KAFKA-COMPLETION] ❌ Error in quiz completion consumer: {e}")
                logger.error(f"Error in quiz completion consumer: {e}", exc_info=True)
        
        import threading
        completion_thread = threading.Thread(target=completion_loop, daemon=True)
        completion_thread.start()
        print("[KAFKA-COMPLETION] ✅ Quiz completion consumer started in background thread")
        logger.info("Quiz completion consumer started")
    else:
        print("[KAFKA-COMPLETION] ❌ Failed to create completion consumer")


@router.post("/quiz/result", response_model=QuizResultSaveResponseDTO)
async def save_quiz_result(
    dto: QuizResultSaveDTO,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save a quiz result to the user's quiz history.
    Works for both regular quizzes and file-based quizzes.
    """
    # Validate input
    if dto.score > dto.total:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Score cannot be greater than total"}
        )
    
    if not dto.topic or not dto.topic.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Topic is required"}
        )
    
    if not dto.level or not dto.level.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Level is required"}
        )
    
    try:
        # Create quiz result
        user_id = uuid.UUID(current_user["id"])
        quiz_result = QuizResult(
            user_id=user_id,
            topic=dto.topic.strip(),
            level=dto.level.strip(),
            score=dto.score,
            total=dto.total,
        )
        
        db.add(quiz_result)
        await db.commit()
        await db.refresh(quiz_result)
        
        logger.info(f"Quiz result saved: user_id={user_id}, topic={dto.topic}, score={dto.score}/{dto.total}")
        
        # Fetch updated user with quiz results
        from sqlalchemy import select
        result = await db.execute(
            select(User).where(User.id == user_id)
        )
        user = result.scalar_one_or_none()
        
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "USER_NOT_FOUND", "message": "User not found"}
            )
        
        # Convert quiz results to history format
        quiz_history = []
        if user.quiz_results:
            quiz_history = [
                QuizHistoryItemDTO(
                    topic=qr.topic,
                    level=qr.level,
                    score=qr.score,
                    total=qr.total,
                    completedAt=qr.completed_at.isoformat() if qr.completed_at else None,
                )
                for qr in user.quiz_results
            ]
        
        return QuizResultSaveResponseDTO(
            success=True,
            quizHistory=quiz_history
        )
        
    except Exception as e:
        await db.rollback()
        logger.error(f"Error saving quiz result: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR", "message": "Failed to save quiz result"}
        )

