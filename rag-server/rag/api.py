# rag/api.py
"""
Internal HTTP API for rag-server.

This module exposes a FastAPI app with internal endpoints used by py-backend
to query the vector store on behalf of authenticated users. All endpoints are
gated by a shared secret header (X-Internal-Secret) and are intended to be
reachable only on localhost.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from rag.core.config import settings
from rag.services.embedding_service import EmbeddingService
from rag.services.vector_store import VectorStore

logger = logging.getLogger(__name__)


class SearchRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    query: str = Field(..., min_length=1)
    top_k: Optional[int] = Field(default=5, ge=1, le=20)


class DocumentSummary(BaseModel):
    document_id: str
    title: str
    chunk_count: int
    topic: Optional[str] = None
    level: Optional[str] = None


class DocumentsResponse(BaseModel):
    documents: List[DocumentSummary]


class SearchResultItem(BaseModel):
    chunk_id: str
    document_id: str
    text: str
    score: float
    chunk_index: Optional[int] = None


class SearchResponse(BaseModel):
    results: List[SearchResultItem]


class ChunkItem(BaseModel):
    chunk_id: str
    text: str
    chunk_index: Optional[int] = None


class ChunksResponse(BaseModel):
    document_id: str
    chunks: List[ChunkItem]


def _title_from_source(source_key: str) -> str:
    """Derive a human-friendly title from an S3 key."""
    if not source_key:
        return ""
    base = source_key.rsplit("/", 1)[-1]
    if "." in base:
        base = base.rsplit(".", 1)[0]
    return base


def _get_secret_value() -> str:
    """Resolve the internal shared secret from settings."""
    secret = settings.RAG_INTERNAL_SECRET
    if hasattr(secret, "get_secret_value"):
        return secret.get_secret_value()
    return str(secret) if secret else ""


def _require_internal_secret(
    x_internal_secret: Optional[str] = Header(default=None, alias="X-Internal-Secret"),
) -> None:
    """Dependency that rejects requests without the correct shared secret."""
    expected = _get_secret_value()
    if not expected:
        # If the server is misconfigured, refuse all requests rather than
        # silently allowing access.
        logger.error("RAG_INTERNAL_SECRET is not configured; refusing request")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "INTERNAL_SECRET_NOT_CONFIGURED"},
        )
    if not x_internal_secret or x_internal_secret != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED"},
        )


def create_api(
    vector_store: VectorStore,
    embedding_service: EmbeddingService,
) -> FastAPI:
    """Build the FastAPI app, wiring in the provided services."""

    app = FastAPI(title="RAG Internal API")

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"ok": True}

    @app.get(
        "/internal/agent/documents",
        response_model=DocumentsResponse,
        dependencies=[Depends(_require_internal_secret)],
    )
    async def list_documents(user_id: str = Query(..., min_length=1)) -> DocumentsResponse:
        try:
            collection = vector_store.collection
            if collection is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={"code": "VECTOR_STORE_UNAVAILABLE"},
                )

            result = collection.get(where={"user_id": user_id})
            metadatas = result.get("metadatas") or []

            grouped: Dict[str, Dict[str, Any]] = {}
            for meta in metadatas:
                if not isinstance(meta, dict):
                    continue
                source = meta.get("source")
                if not source:
                    continue
                entry = grouped.get(source)
                if entry is None:
                    grouped[source] = {
                        "document_id": source,
                        "title": _title_from_source(source),
                        "chunk_count": 1,
                        "topic": meta.get("topic"),
                        "level": meta.get("level"),
                    }
                else:
                    entry["chunk_count"] = entry["chunk_count"] + 1

            docs = [DocumentSummary(**v) for v in grouped.values()]
            docs.sort(key=lambda d: d.title.lower())
            return DocumentsResponse(documents=docs)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("list_documents failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "LIST_DOCUMENTS_FAILED", "message": str(exc)},
            )

    @app.post(
        "/internal/agent/search",
        response_model=SearchResponse,
        dependencies=[Depends(_require_internal_secret)],
    )
    async def search(body: SearchRequest) -> SearchResponse:
        try:
            top_k = body.top_k if body.top_k is not None else 5
            top_k = max(1, min(top_k, 20))
            embedding = embedding_service.embed_text(body.query)
            results = vector_store.query(
                query_embeddings=[embedding],
                n_results=top_k,
                where={"user_id": body.user_id},
            )
            return SearchResponse(results=_format_query_results(results))
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("search failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "SEARCH_FAILED", "message": str(exc)},
            )

    @app.get(
        "/internal/agent/documents/{document_id:path}/section",
        response_model=SearchResponse,
        dependencies=[Depends(_require_internal_secret)],
    )
    async def get_section(
        document_id: str,
        user_id: str = Query(..., min_length=1),
        query: str = Query(..., min_length=1),
        top_k: int = Query(default=3, ge=1, le=20),
    ) -> SearchResponse:
        try:
            embedding = embedding_service.embed_text(query)
            results = vector_store.query(
                query_embeddings=[embedding],
                n_results=top_k,
                where={"$and": [{"user_id": user_id}, {"source": document_id}]},
            )
            return SearchResponse(results=_format_query_results(results))
        except Exception as exc:
            logger.error("get_section failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "SECTION_FAILED", "message": str(exc)},
            )

    @app.get(
        "/internal/agent/documents/{document_id:path}/chunks",
        response_model=ChunksResponse,
        dependencies=[Depends(_require_internal_secret)],
    )
    async def get_chunks(
        document_id: str,
        user_id: str = Query(..., min_length=1),
        limit: int = Query(default=50, ge=1, le=200),
    ) -> ChunksResponse:
        try:
            collection = vector_store.collection
            if collection is None:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail={"code": "VECTOR_STORE_UNAVAILABLE"},
                )

            result = collection.get(
                where={"$and": [{"user_id": user_id}, {"source": document_id}]}
            )
            ids = result.get("ids") or []
            docs = result.get("documents") or []
            metas = result.get("metadatas") or []

            rows: List[Dict[str, Any]] = []
            for i, cid in enumerate(ids):
                meta = metas[i] if i < len(metas) and isinstance(metas[i], dict) else {}
                text = docs[i] if i < len(docs) else ""
                rows.append(
                    {
                        "chunk_id": cid,
                        "text": text,
                        "chunk_index": meta.get("chunk_index"),
                    }
                )

            def _sort_key(row: Dict[str, Any]) -> int:
                ci = row.get("chunk_index")
                try:
                    return int(ci) if ci is not None else 0
                except (TypeError, ValueError):
                    return 0

            rows.sort(key=_sort_key)
            rows = rows[:limit]

            chunks = [ChunkItem(**r) for r in rows]
            return ChunksResponse(document_id=document_id, chunks=chunks)
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("get_chunks failed: %s", exc, exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "CHUNKS_FAILED", "message": str(exc)},
            )

    return app


def _format_query_results(results: Dict[str, Any]) -> List[SearchResultItem]:
    """Flatten ChromaDB query() output into a list of SearchResultItem."""
    ids_outer = results.get("ids") or []
    docs_outer = results.get("documents") or []
    metas_outer = results.get("metadatas") or []
    dists_outer = results.get("distances") or []

    ids = ids_outer[0] if ids_outer else []
    docs = docs_outer[0] if docs_outer else []
    metas = metas_outer[0] if metas_outer else []
    dists = dists_outer[0] if dists_outer else []

    items: List[SearchResultItem] = []
    for i, cid in enumerate(ids):
        meta = metas[i] if i < len(metas) and isinstance(metas[i], dict) else {}
        text = docs[i] if i < len(docs) else ""
        dist = dists[i] if i < len(dists) else None
        try:
            score = 1.0 - float(dist) if dist is not None else 0.0
        except (TypeError, ValueError):
            score = 0.0
        items.append(
            SearchResultItem(
                chunk_id=cid,
                document_id=str(meta.get("source", "")),
                text=text,
                score=score,
                chunk_index=meta.get("chunk_index"),
            )
        )
    return items
