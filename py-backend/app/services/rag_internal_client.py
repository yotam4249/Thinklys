# app/services/rag_internal_client.py
"""
Async HTTP client for the rag-server internal API.

py-backend talks to rag-server over HTTP (localhost) with a shared-secret
header. This client centralises the URL building, header injection, and
error translation.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger(__name__)


class RagInternalClient:
    """Thin wrapper around httpx for calling rag-server /internal/agent/*."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        secret: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        self._base_url = (base_url or settings.RAG_INTERNAL_BASE_URL).rstrip("/")
        self._secret = secret if secret is not None else settings.RAG_INTERNAL_SECRET.get_secret_value()
        self._timeout = timeout

    def _headers(self) -> Dict[str, str]:
        return {
            "X-Internal-Secret": self._secret,
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

    @staticmethod
    def _encode_document_id(document_id: str) -> str:
        # S3 keys contain '/'; we want to keep them in the path so the
        # rag-server `:path` converter receives them intact.
        return quote(document_id, safe="/")

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                resp = await client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            logger.error("RAG internal request failed: %s %s -> %s", method, url, exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "RAG_UNREACHABLE", "message": str(exc)},
            )

        if resp.status_code >= 400:
            try:
                body = resp.json()
            except Exception:
                body = {"detail": resp.text}
            logger.error(
                "RAG internal request returned %s: %s %s body=%s",
                resp.status_code,
                method,
                url,
                body,
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "RAG_ERROR", "status": resp.status_code, "body": body},
            )

        try:
            return resp.json()
        except Exception as exc:
            logger.error("Failed to decode RAG response JSON: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "RAG_BAD_JSON"},
            )

    async def list_documents(self, user_id: str) -> Dict[str, Any]:
        return await self._request(
            "GET",
            "/internal/agent/documents",
            params={"user_id": user_id},
        )

    async def search(
        self,
        user_id: str,
        query: str,
        top_k: Optional[int] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"user_id": user_id, "query": query}
        if top_k is not None:
            body["top_k"] = top_k
        return await self._request("POST", "/internal/agent/search", json_body=body)

    async def get_section(
        self,
        user_id: str,
        document_id: str,
        query: str,
        top_k: int = 3,
    ) -> Dict[str, Any]:
        encoded = self._encode_document_id(document_id)
        return await self._request(
            "GET",
            f"/internal/agent/documents/{encoded}/section",
            params={"user_id": user_id, "query": query, "top_k": top_k},
        )

    async def get_chunks(
        self,
        user_id: str,
        document_id: str,
        limit: int = 50,
    ) -> Dict[str, Any]:
        encoded = self._encode_document_id(document_id)
        return await self._request(
            "GET",
            f"/internal/agent/documents/{encoded}/chunks",
            params={"user_id": user_id, "limit": limit},
        )


# Module-level singleton for convenience.
rag_internal_client = RagInternalClient()
