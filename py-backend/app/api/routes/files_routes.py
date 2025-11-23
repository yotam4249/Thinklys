# app/api/routes/files_routes.py
from fastapi import APIRouter, Depends, HTTPException, status, Query, Request
from typing import Optional
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.services.s3_service import (
    get_presigned_put_url,
    get_presigned_get_url,
    generate_s3_key,
    ALLOWED_IMAGE_TYPES,
)
from app.api.dto.files_dto import (
    PresignUploadDTO,
    PresignUploadResponseDTO,
    PresignGetResponseDTO,
)
from app.core.security import verify_access_token

router = APIRouter(prefix="/files", tags=["files"])
security = HTTPBearer(auto_error=False)


async def get_optional_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    """Optional authentication - returns user if token is valid, None otherwise."""
    if not credentials:
        # Try to get from Authorization header directly
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ")[1]
        else:
            return None
    else:
        token = credentials.credentials
    
    try:
        payload = verify_access_token(token)
        if payload:
            return {
                "id": payload.get("sub"),
                "username": payload.get("username"),
            }
    except Exception:
        pass
    
    return None


@router.post(
    "/s3/presign-upload",
    response_model=PresignUploadResponseDTO,
    status_code=status.HTTP_200_OK,
)
async def presign_upload(
    dto: PresignUploadDTO,
    current_user: Optional[dict] = Depends(get_optional_user),
):
    """
    Generate a presigned URL for uploading a file to S3.
    
    - For 'users/new' prefix: allows unauthenticated access (for registration)
    - For other prefixes: requires authentication
    """
    # Validate content type
    if dto.contentType not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_CONTENT_TYPE"},
        )
    
    # Check if authentication is required
    prefix = dto.prefix or ""
    requires_auth = not (isinstance(prefix, str) and prefix.startswith("users/new"))
    
    if requires_auth and not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "UNAUTHORIZED"},
        )
    
    # Generate S3 key
    key = generate_s3_key(
        content_type=dto.contentType,
        filename=dto.filename,
        prefix=dto.prefix,
    )
    
    # Generate presigned URL
    try:
        result = get_presigned_put_url(key=key, content_type=dto.contentType)
        return PresignUploadResponseDTO(url=result["url"], key=result["key"])
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR", "message": str(e)},
        )


@router.get(
    "/s3/presign-get",
    response_model=PresignGetResponseDTO,
    status_code=status.HTTP_200_OK,
)
async def presign_get(
    key: str = Query(..., description="S3 object key (path)"),
):
    """
    Generate a presigned URL for downloading a file from S3.
    Public endpoint - no authentication required.
    """
    if not key or not key.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "NO_KEY"},
        )
    
    try:
        url = get_presigned_get_url(key=key.strip())
        return PresignGetResponseDTO(url=url)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "SERVER_ERROR", "message": str(e)},
        )

