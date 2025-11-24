# app/api/routes/qa_routes.py
from fastapi import APIRouter, HTTPException, status
import logging

from app.services.ai_cache_service import get_cached_answer, set_cached_answer
from app.services.openai_service import ask_openai_question
from app.api.dto.qa_dto import QARequestDTO, QAResponseDTO

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["qa"])


@router.post("/qa", response_model=QAResponseDTO)
async def qa_answer(dto: QARequestDTO):
    """Answer a question using OpenAI with caching."""
    question = dto.question.strip()
    logger.info(f"[QA] Incoming question: {question}")

    if not question:
        logger.warning("[QA] Missing question")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Missing question"}
        )

    try:
        # 1) Cache lookup
        cached = await get_cached_answer(question)
        if cached:
            logger.info("[QA] Cache HIT → returning cached answer")
            return QAResponseDTO(cached=True, answer=cached)

        logger.info("[QA] Cache MISS → calling OpenAI")

        # 2) OpenAI
        answer = await ask_openai_question(question)
        logger.info(f"[QA] OpenAI answer length: {len(answer) if answer else 0}")

        if not answer:
            logger.error("[QA] OpenAI returned empty answer")
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"error": "openai_empty_answer"}
            )

        # 3) Save to cache
        await set_cached_answer(question, answer)
        logger.info("[QA] Saved to cache OK")

        return QAResponseDTO(cached=False, answer=answer)

    except HTTPException:
        raise
    except Exception as err:
        logger.error(f"[QA] Error: {err}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "server_error", "detail": str(err)}
        )

