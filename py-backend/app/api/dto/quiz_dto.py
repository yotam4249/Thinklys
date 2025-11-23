# app/api/dto/quiz_dto.py
from pydantic import BaseModel, Field
from typing import List, Optional


class QuizGenerateRequestDTO(BaseModel):
    """DTO for quiz generation request."""
    topic: str = Field(..., description="Quiz topic")
    level: str = Field(..., description="Difficulty level (beginner, intermediate, advanced)")
    files: Optional[List[str]] = Field(None, description="List of S3 file keys")
    fileTypes: Optional[List[str]] = Field(None, description="List of MIME types for files")


class QuizItemDTO(BaseModel):
    """DTO for a quiz item."""
    id: str
    question: str
    options: List[str] = Field(..., min_items=4, max_items=4)
    correctIndex: int = Field(..., ge=0, le=3)


class QuizResponseDTO(BaseModel):
    """DTO for quiz response."""
    topic: str
    level: str
    items: List[QuizItemDTO] = Field(..., min_items=5, max_items=5)


class QuizGenerateResponseDTO(BaseModel):
    """DTO for quiz generation API response."""
    success: bool
    quiz: Optional[QuizResponseDTO] = None
    error: Optional[str] = None
    cached: bool = False

