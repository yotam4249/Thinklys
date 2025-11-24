# app/api/routes/quiz_routes.py
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import Dict, Any, Optional
import asyncio
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from app.middleware.auth_middleware import get_current_user
from app.services.kafka_service import kafka_service, new_request_id
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
    current_user: Optional[dict] = Depends(get_current_user),
):
    """
    Generate a quiz using RAG server via Kafka.
    This endpoint publishes a request to Kafka and waits for the RAG server response.
    """
    # Validate input
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
    
    # Check cache first (optional - can use Redis)
    # Include files in cache key if present to avoid cache collisions
    redis_client = await get_redis()
    files_hash = ""
    if dto.files and len(dto.files) > 0:
        import hashlib
        files_str = ",".join(sorted(dto.files))
        files_hash = hashlib.md5(files_str.encode()).hexdigest()[:8]
    cache_key = f"quiz:{dto.topic}:{dto.level}:{files_hash}" if files_hash else f"quiz:{dto.topic}:{dto.level}"
    cached = await redis_client.get(cache_key)
    
    if cached:
        try:
            quiz_data = json.loads(cached)
            logger.info(f"Quiz cache hit: {dto.topic}:{dto.level}")
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
        "topic": dto.topic.strip(),
        "level": dto.level.strip(),
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
        topic=quiz_data.get("topic", dto.topic),
        level=quiz_data.get("level", dto.level),
        items=quiz_items
    )
    
    return QuizGenerateResponseDTO(
        success=True,
        quiz=quiz_response,
        cached=False
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

