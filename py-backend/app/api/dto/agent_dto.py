# app/api/dto/agent_dto.py
from typing import List, Optional

from pydantic import BaseModel, Field


class DocumentSummaryDTO(BaseModel):
    document_id: str
    title: str
    chunk_count: int
    topic: Optional[str] = None
    level: Optional[str] = None


class DocumentsResponseDTO(BaseModel):
    documents: List[DocumentSummaryDTO]


class SearchRequestDTO(BaseModel):
    query: str = Field(..., min_length=1)
    top_k: Optional[int] = Field(default=None, ge=1, le=20)


class SearchResultItemDTO(BaseModel):
    chunk_id: str
    document_id: str
    text: str
    score: float
    chunk_index: Optional[int] = None


class SearchResponseDTO(BaseModel):
    results: List[SearchResultItemDTO]


class ChunkItemDTO(BaseModel):
    chunk_id: str
    text: str
    chunk_index: Optional[int] = None


class ChunksResponseDTO(BaseModel):
    document_id: str
    chunks: List[ChunkItemDTO]
