# app/api/routes/agent_routes.py
"""
Agent-facing endpoints. These mirror the read-only document tools the TS
agent layer needs and are JWT-protected just like the rest of the API.
The actual ChromaDB/embedding work happens in rag-server; this layer
forwards the call (adding user scoping from the JWT).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.api.dto.agent_dto import (
    ChunksResponseDTO,
    DocumentsResponseDTO,
    SearchRequestDTO,
    SearchResponseDTO,
)
from app.middleware.auth_middleware import get_current_user
from app.services.rag_internal_client import rag_internal_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agent", tags=["agent"])


def _require_user_id(current_user: dict) -> str:
    user_id = current_user.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "INVALID_TOKEN"},
        )
    return str(user_id)


@router.get("/documents", response_model=DocumentsResponseDTO)
async def list_documents(current_user: dict = Depends(get_current_user)) -> DocumentsResponseDTO:
    user_id = _require_user_id(current_user)
    data = await rag_internal_client.list_documents(user_id)
    return DocumentsResponseDTO(**data)


@router.post("/search", response_model=SearchResponseDTO)
async def search(
    dto: SearchRequestDTO,
    current_user: dict = Depends(get_current_user),
) -> SearchResponseDTO:
    user_id = _require_user_id(current_user)
    data = await rag_internal_client.search(
        user_id=user_id,
        query=dto.query,
        top_k=dto.top_k,
    )
    return SearchResponseDTO(**data)


@router.get("/documents/{document_id:path}/section", response_model=SearchResponseDTO)
async def get_section(
    document_id: str,
    query: str = Query(..., min_length=1),
    top_k: int = Query(default=3, ge=1, le=20),
    current_user: dict = Depends(get_current_user),
) -> SearchResponseDTO:
    user_id = _require_user_id(current_user)
    data = await rag_internal_client.get_section(
        user_id=user_id,
        document_id=document_id,
        query=query,
        top_k=top_k,
    )
    return SearchResponseDTO(**data)


@router.get("/documents/{document_id:path}/chunks", response_model=ChunksResponseDTO)
async def get_chunks(
    document_id: str,
    limit: int = Query(default=50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
) -> ChunksResponseDTO:
    user_id = _require_user_id(current_user)
    data = await rag_internal_client.get_chunks(
        user_id=user_id,
        document_id=document_id,
        limit=limit,
    )
    return ChunksResponseDTO(**data)
