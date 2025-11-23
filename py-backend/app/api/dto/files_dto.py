# app/api/dto/files_dto.py
from pydantic import BaseModel, Field
from typing import Optional


class PresignUploadDTO(BaseModel):
    """DTO for presigned upload URL request."""
    contentType: str = Field(..., description="MIME type of the file (e.g., image/jpeg)")
    filename: Optional[str] = Field(None, description="Optional original filename")
    prefix: Optional[str] = Field(None, description="Optional folder prefix (e.g., 'users/new', 'chat/images')")


class PresignUploadResponseDTO(BaseModel):
    """Response DTO for presigned upload URL."""
    url: str = Field(..., description="Presigned PUT URL for uploading")
    key: str = Field(..., description="S3 object key (path)")


class PresignGetResponseDTO(BaseModel):
    """Response DTO for presigned GET URL."""
    url: str = Field(..., description="Presigned GET URL for downloading")

