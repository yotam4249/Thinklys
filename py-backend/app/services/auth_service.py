# app/services/auth_service.py
from datetime import date, datetime, timedelta, timezone
from typing import Optional
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
import redis.asyncio as redis

from app.core.security import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    verify_refresh_token,
)
from app.core.redis import get_redis
from app.models.user import User
from app.models.quiz_result import QuizResult


class AuthService:
    """Authentication service with Redis + PostgreSQL hybrid storage."""

    @staticmethod
    def _get_redis_key(user_id: str) -> str:
        """Get Redis key for user's refresh token."""
        return f"refresh_token:{user_id}"

    @staticmethod
    async def store_refresh_token(user_id: str, token: str) -> None:
        """Store refresh token in Redis with expiration."""
        from app.core.config import settings
        
        redis_client = await get_redis()
        key = AuthService._get_redis_key(user_id)
        # Store token with expiration (from settings, in days, convert to seconds)
        expire_seconds = settings.REFRESH_TOKEN_EXPIRE * 24 * 60 * 60
        await redis_client.setex(key, expire_seconds, token)

    @staticmethod
    async def get_refresh_token(user_id: str) -> Optional[str]:
        """Get refresh token from Redis."""
        redis_client = await get_redis()
        key = AuthService._get_redis_key(user_id)
        return await redis_client.get(key)

    @staticmethod
    async def delete_refresh_token(user_id: str) -> None:
        """Delete refresh token from Redis."""
        redis_client = await get_redis()
        key = AuthService._get_redis_key(user_id)
        await redis_client.delete(key)

    @staticmethod
    async def verify_refresh_token_in_redis(user_id: str, token: str) -> bool:
        """Verify that the provided token matches the one stored in Redis."""
        stored_token = await AuthService.get_refresh_token(user_id)
        return stored_token == token

    @staticmethod
    async def register(
        db: AsyncSession,
        username: str,
        password: str,
        date_of_birth: Optional[date] = None,
        gender: Optional[str] = None,
        profile_image: Optional[str] = None,
    ) -> User:
        """Register a new user."""
        # Check if user exists
        result = await db.execute(select(User).where(User.username == username))
        existing_user = result.scalar_one_or_none()
        if existing_user:
            raise ValueError("USERNAME_EXISTS")

        # Validate age if date_of_birth provided
        if date_of_birth:
            age = (datetime.now().date() - date_of_birth).days // 365
            if age < 16:
                raise ValueError("AGE_TOO_YOUNG")

        # Hash password
        hashed_password = hash_password(password)

        # Create user
        user = User(
            username=username,
            password=hashed_password,
            dateOfBirth=date_of_birth,
            gender=gender,
            profileImage=profile_image,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user

    @staticmethod
    async def login(db: AsyncSession, username: str, password: str) -> User:
        """Authenticate a user."""
        result = await db.execute(select(User).where(User.username == username))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("INVALID_CREDENTIALS")

        if not verify_password(password, user.password):
            raise ValueError("INVALID_CREDENTIALS")

        return user

    @staticmethod
    async def issue_tokens(user: User) -> tuple[str, str]:
        """Issue access and refresh tokens for a user."""
        user_id_str = str(user.id)
        payload = {"sub": user_id_str, "username": user.username}

        access_token = create_access_token(payload)
        refresh_token = create_refresh_token(payload)

        # Store refresh token in Redis
        await AuthService.store_refresh_token(user_id_str, refresh_token)

        return access_token, refresh_token

    @staticmethod
    async def refresh_tokens(
        db: AsyncSession, refresh_token: str
    ) -> tuple[str, str, User]:
        """Refresh access token using refresh token."""
        # Verify token signature
        payload = verify_refresh_token(refresh_token)
        if not payload:
            raise ValueError("REFRESH_INVALID")

        user_id_str = payload.get("sub")
        if not user_id_str:
            raise ValueError("REFRESH_INVALID")

        # Verify token exists in Redis
        is_valid = await AuthService.verify_refresh_token_in_redis(
            user_id_str, refresh_token
        )
        if not is_valid:
            raise ValueError("REFRESH_REVOKED")

        # Get user
        user_id = uuid.UUID(user_id_str)
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if not user:
            raise ValueError("USER_NOT_FOUND")

        # Issue new tokens (rotate refresh token)
        new_access_token, new_refresh_token = await AuthService.issue_tokens(user)

        return new_access_token, new_refresh_token, user

    @staticmethod
    async def logout(user_id: str) -> None:
        """Logout user by removing refresh token from Redis."""
        await AuthService.delete_refresh_token(user_id)

    @staticmethod
    async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> Optional[User]:
        """Get user by ID."""
        result = await db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def get_user_by_username(
        db: AsyncSession, username: str
    ) -> Optional[User]:
        """Get user by username."""
        result = await db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

