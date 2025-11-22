# app/api/dto/auth_dto.py
from datetime import date
from typing import Optional
from pydantic import BaseModel, Field, field_validator
from app.models.enums.gender import GenderEnum


class RegisterDTO(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    password: str = Field(..., min_length=6)
    dateOfBirth: Optional[date] = None
    gender: Optional[GenderEnum] = None
    profileImage: Optional[str] = None

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        return v.strip().lower()


class LoginDTO(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        return v.strip().lower()


class RefreshDTO(BaseModel):
    refreshToken: Optional[str] = None  # Optional for cookie-based refresh


class LogoutDTO(BaseModel):
    refreshToken: Optional[str] = None  # Optional for cookie-based refresh


class UpdateProfileDTO(BaseModel):
    dateOfBirth: Optional[date] = None
    gender: Optional[GenderEnum] = None
    profileImage: Optional[str] = None


class UpdatePasswordDTO(BaseModel):
    currentPassword: str
    newPassword: str = Field(..., min_length=6)


class UserResponse(BaseModel):
    id: str
    username: str
    dateOfBirth: Optional[date] = None
    gender: Optional[GenderEnum] = None
    profileImage: Optional[str] = None
    profileImageUrl: Optional[str] = None
    quizHistory: list = []

    class Config:
        from_attributes = True


class AuthResponse(BaseModel):
    user: UserResponse
    accessToken: str
    refreshToken: str


class TokenResponse(BaseModel):
    accessToken: str
    refreshToken: str
