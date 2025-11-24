# app/api/dto/qa_dto.py
from pydantic import BaseModel, Field


class QARequestDTO(BaseModel):
    """DTO for Q&A request."""
    question: str = Field(..., description="Question to ask")


class QAResponseDTO(BaseModel):
    """DTO for Q&A response."""
    cached: bool = Field(..., description="Whether the answer was cached")
    answer: str = Field(..., description="Answer to the question")

