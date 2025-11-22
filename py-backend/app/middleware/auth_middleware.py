# app/middleware/auth_middleware.py
from typing import Optional
from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.core.security import verify_access_token
import uuid


class AuthMiddleware:
    """Authentication middleware for protecting routes."""

    def __init__(self):
        self.security = HTTPBearer()

    async def __call__(
        self, request: Request, credentials: HTTPAuthorizationCredentials = None
    ) -> dict:
        """Extract and verify access token from request."""
        # Try to get token from Authorization header
        auth_header = request.headers.get("Authorization")
        if not auth_header or not auth_header.startswith("Bearer "):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "NO_TOKEN"},
            )

        token = auth_header.split(" ")[1]
        payload = verify_access_token(token)

        if not payload:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "INVALID_TOKEN"},
            )

        user_id = payload.get("sub")
        username = payload.get("username")

        if not user_id or not username:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "INVALID_TOKEN"},
            )

        # Store user info in request state
        request.state.user = {
            "id": user_id,
            "username": username,
        }

        return {"id": user_id, "username": username}


# Dependency function for FastAPI
async def get_current_user(request: Request) -> dict:
    """Dependency to get current authenticated user."""
    middleware = AuthMiddleware()
    return await middleware(request)

