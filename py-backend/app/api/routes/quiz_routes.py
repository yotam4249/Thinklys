# app/api/routes/quiz_routes.py
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from typing import Dict, Any, Optional
import asyncio
import logging
from app.middleware.auth_middleware import get_current_user
from app.services.kafka_service import kafka_service, new_request_id
from app.core.config import settings
from app.core.redis import get_redis
from app.api.dto.quiz_dto import (
    QuizGenerateRequestDTO,
    QuizGenerateResponseDTO,
    QuizResponseDTO,
    QuizItemDTO,
)
import json

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
    request_id = message.get("requestId")
    if not request_id:
        return
    
    future = pending_requests.get(request_id)
    if future and not future.done():
        future.set_result(message)
        logger.info(f"Quiz response received and set: {request_id}")


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
    redis_client = await get_redis()
    cache_key = f"quiz:{dto.topic}:{dto.level}"
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


# Start Kafka consumer for quiz responses in background
async def start_quiz_response_consumer():
    """Start consuming quiz responses from Kafka."""
    if not settings.KAFKA_BROKERS:
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
                for message in consumer:
                    process_quiz_response(message.value)
            except Exception as e:
                logger.error(f"Error in quiz response consumer: {e}", exc_info=True)
        
        import threading
        thread = threading.Thread(target=consume_loop, daemon=True)
        thread.start()
        logger.info("Quiz response consumer started")

