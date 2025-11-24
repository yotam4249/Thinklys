# app/api/routes/auth_routes.py
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Request, Response, Cookie
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.core.db import get_db
from app.middleware.auth_middleware import get_current_user
from app.services.auth_service import AuthService
from app.services.s3_service import get_presigned_get_url
from app.api.dto.auth_dto import (
    RegisterDTO,
    LoginDTO,
    RefreshDTO,
    LogoutDTO,
    UpdateProfileDTO,
    UpdatePasswordDTO,
    UserResponse,
    AuthResponse,
    TokenResponse,
)
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["auth"])

# Cookie name for refresh token
REFRESH_COOKIE_NAME = "refreshToken"


def _user_to_response(user: User, profile_image_url: Optional[str] = None) -> UserResponse:
    """Convert User model to UserResponse DTO."""
    # Convert quiz_results to list format
    quiz_history = []
    if user.quiz_results:
        quiz_history = [
            {
                "topic": qr.topic,
                "level": qr.level,
                "score": qr.score,
                "total": qr.total,
                "completedAt": qr.completed_at.isoformat() if qr.completed_at else None,
            }
            for qr in user.quiz_results
        ]

    return UserResponse(
        id=str(user.id),
        username=user.username,
        dateOfBirth=user.dateOfBirth,
        gender=user.gender,
        profileImage=user.profileImage,
        profileImageUrl=profile_image_url,
        quizHistory=quiz_history,
    )


def _set_refresh_cookie(response: Response, token: str) -> None:
    """Set refresh token as HTTP-only cookie."""
    from app.core.config import settings
    is_prod = settings.APP_ENV == "production"
    # Use settings for expiration (in days, convert to seconds)
    max_age = settings.REFRESH_TOKEN_EXPIRE * 24 * 60 * 60
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_prod,
        samesite="none" if is_prod else "lax",
        path="/",
        max_age=max_age,
    )


def _clear_refresh_cookie(response: Response) -> None:
    """Clear refresh token cookie."""
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path="/",
        samesite="none",
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    dto: RegisterDTO,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Register a new user."""
    try:
        user = await AuthService.register(
            db=db,
            username=dto.username,
            password=dto.password,
            date_of_birth=dto.dateOfBirth,
            gender=dto.gender,
            profile_image=dto.profileImage,
        )

        access_token, refresh_token = await AuthService.issue_tokens(user)

        # Set refresh token cookie
        _set_refresh_cookie(response, refresh_token)

        user_response = _user_to_response(user)

        return AuthResponse(
            user=user_response,
            accessToken=access_token,
            refreshToken=refresh_token,  # Also return in body for mobile clients
        )
    except ValueError as e:
        error_code = str(e)
        if error_code == "USERNAME_EXISTS":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail={"code": error_code}
            )
        elif error_code == "AGE_TOO_YOUNG":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "BAD_REQUEST"}
        )


@router.post("/login", response_model=AuthResponse)
async def login(
    dto: LoginDTO,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Login user."""
    try:
        user = await AuthService.login(db=db, username=dto.username, password=dto.password)

        access_token, refresh_token = await AuthService.issue_tokens(user)

        # Set refresh token cookie
        _set_refresh_cookie(response, refresh_token)

        # Generate presigned URL for profile image if exists
        profile_image_url = None
        if user.profileImage:
            try:
                profile_image_url = get_presigned_get_url(user.profileImage)
            except Exception:
                pass  # If presigned URL generation fails, continue without it

        user_response = _user_to_response(user, profile_image_url=profile_image_url)

        return AuthResponse(
            user=user_response,
            accessToken=access_token,
            refreshToken=refresh_token,  # Also return in body for mobile clients
        )
    except ValueError as e:
        error_code = str(e)
        if error_code == "INVALID_CREDENTIALS":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "BAD_REQUEST"}
        )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    response: Response,
    dto: Optional[RefreshDTO] = None,
    refreshToken: Optional[str] = Cookie(None, alias=REFRESH_COOKIE_NAME),
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token."""
    # Prefer cookie, fallback to body
    token = refreshToken or (dto.refreshToken if dto else None)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "NO_REFRESH"}
        )

    try:
        new_access_token, new_refresh_token, user = await AuthService.refresh_tokens(
            db=db, refresh_token=token
        )

        # Set new refresh token cookie
        _set_refresh_cookie(response, new_refresh_token)

        return TokenResponse(
            accessToken=new_access_token, refreshToken=new_refresh_token
        )
    except ValueError as e:
        error_code = str(e)
        if error_code in ["REFRESH_INVALID", "REFRESH_REVOKED", "USER_NOT_FOUND"]:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": error_code}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR"},
        )


@router.post("/logout")
async def logout(
    response: Response,
    dto: Optional[LogoutDTO] = None,
    refreshToken: Optional[str] = Cookie(None, alias=REFRESH_COOKIE_NAME),
):
    """Logout user. Does not require authentication - only needs refresh token."""
    # Prefer cookie, fallback to body
    token = refreshToken or (dto.refreshToken if dto else None)

    if not token:
        # Still clear cookie even if no token provided
        _clear_refresh_cookie(response)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "NO_REFRESH"}
        )

    # Verify token to get user_id
    from app.core.security import verify_refresh_token

    payload = verify_refresh_token(token)
    if payload:
        user_id = payload.get("sub")
        if user_id:
            await AuthService.logout(user_id)

    # Clear cookie
    _clear_refresh_cookie(response)

    return {"ok": True}


@router.get("/me")
async def me(
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get current user profile."""
    user_id = uuid.UUID(current_user["id"])
    user = await AuthService.get_user_by_id(db=db, user_id=user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"}
        )

    # Generate presigned URL for profile image if exists
    profile_image_url = None
    if user.profileImage:
        try:
            profile_image_url = get_presigned_get_url(user.profileImage)
        except Exception:
            pass  # If presigned URL generation fails, continue without it

    user_response = _user_to_response(user, profile_image_url=profile_image_url)
    return {"user": user_response}


@router.put("/profile")
async def update_profile(
    dto: UpdateProfileDTO,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update user profile."""
    user_id = uuid.UUID(current_user["id"])
    user = await AuthService.get_user_by_id(db=db, user_id=user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"}
        )

    # Validate age if date_of_birth provided
    if dto.dateOfBirth:
        from datetime import datetime

        age = (datetime.now().date() - dto.dateOfBirth).days // 365
        if age < 16:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail={"code": "AGE_TOO_YOUNG"}
            )

    # Update fields
    if dto.dateOfBirth is not None:
        user.dateOfBirth = dto.dateOfBirth
    if dto.gender is not None:
        user.gender = dto.gender
    if dto.profileImage is not None:
        user.profileImage = dto.profileImage

    await db.commit()
    await db.refresh(user)

    # Generate presigned URL for profile image if exists
    profile_image_url = None
    if user.profileImage:
        try:
            profile_image_url = get_presigned_get_url(user.profileImage)
        except Exception:
            pass  # If presigned URL generation fails, continue without it

    user_response = _user_to_response(user, profile_image_url=profile_image_url)
    return {"user": user_response}


@router.put("/password")
async def update_password(
    dto: UpdatePasswordDTO,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update user password."""
    user_id = uuid.UUID(current_user["id"])
    user = await AuthService.get_user_by_id(db=db, user_id=user_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"}
        )

    from app.core.security import verify_password, hash_password

    # Verify current password
    if not verify_password(dto.currentPassword, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail={"code": "INVALID_PASSWORD"}
        )

    # Update password
    user.password = hash_password(dto.newPassword)
    await db.commit()

    return {"success": True}


@router.get("/user/{user_id}")
async def get_user_profile(
    user_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get user profile by ID."""
    try:
        uid = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "BAD_REQUEST", "message": "Invalid user ID"},
        )

    user = await AuthService.get_user_by_id(db=db, user_id=uid)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail={"code": "NOT_FOUND"}
        )

    # Generate presigned URL for profile image if exists
    profile_image_url = None
    if user.profileImage:
        try:
            profile_image_url = get_presigned_get_url(user.profileImage)
        except Exception:
            pass  # If presigned URL generation fails, continue without it

    user_response = _user_to_response(user, profile_image_url=profile_image_url)
    return {"user": user_response}

