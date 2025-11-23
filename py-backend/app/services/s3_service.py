# app/services/s3_service.py
import boto3
from botocore.exceptions import ClientError
from typing import Optional
import uuid
import mimetypes
from app.core.config import settings

# Initialize S3 client
try:
    s3_client = boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID.get_secret_value(),
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY.get_secret_value(),
    )
except Exception as e:
    # If S3 client initialization fails, set to None
    # This allows the app to start even if S3 is not configured
    # Individual functions will raise appropriate errors
    s3_client = None
    import warnings
    warnings.warn(f"S3 client initialization failed: {e}. S3 features will not work.")


ALLOWED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}


def get_presigned_put_url(
    key: str,
    content_type: str,
    expires_in: int = 300,  # 5 minutes default
) -> dict[str, str]:
    """
    Generate a presigned URL for uploading a file to S3.
    
    Args:
        key: S3 object key (path)
        content_type: MIME type of the file
        expires_in: URL expiration time in seconds (default: 300)
    
    Returns:
        Dictionary with 'url' and 'key'
    """
    if s3_client is None:
        raise ValueError("S3 client is not initialized. Check AWS credentials in environment variables.")
    
    try:
        url = s3_client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": settings.S3_BUCKET,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
        return {"url": url, "key": key, "bucket": settings.S3_BUCKET}
    except ClientError as e:
        raise ValueError(f"Failed to generate presigned PUT URL: {str(e)}")


def get_presigned_get_url(
    key: str,
    expires_in: Optional[int] = None,
) -> str:
    """
    Generate a presigned URL for downloading a file from S3.
    
    Args:
        key: S3 object key (path)
        expires_in: URL expiration time in seconds (default: from settings)
    
    Returns:
        Presigned URL string
    """
    if s3_client is None:
        raise ValueError("S3 client is not initialized. Check AWS credentials in environment variables.")
    
    ttl = expires_in or settings.S3_URL_TTL_SECONDS
    try:
        url = s3_client.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": settings.S3_BUCKET,
                "Key": key,
            },
            ExpiresIn=ttl,
        )
        return url
    except ClientError as e:
        raise ValueError(f"Failed to generate presigned GET URL: {str(e)}")


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for S3 key."""
    # Replace spaces with underscores and remove invalid characters
    sanitized = filename.strip().replace(" ", "_")
    # Keep only alphanumeric, dots, dashes, and underscores
    sanitized = "".join(c for c in sanitized if c.isalnum() or c in "._-")
    return sanitized


def generate_s3_key(
    content_type: str,
    filename: Optional[str] = None,
    prefix: Optional[str] = None,
) -> str:
    """
    Generate an S3 key for a file upload.
    
    Args:
        content_type: MIME type of the file
        filename: Optional original filename
        prefix: Optional folder prefix (e.g., "users/new", "chat/images")
    
    Returns:
        S3 key string
    """
    # Get file extension from content type
    ext = mimetypes.guess_extension(content_type) or ".bin"
    if ext.startswith("."):
        ext = ext[1:]  # Remove leading dot
    
    # Sanitize prefix
    if prefix and isinstance(prefix, str):
        # Remove leading/trailing slashes and validate
        folder = prefix.strip("/")
        # Only allow safe characters in folder path
        folder = "".join(c for c in folder if c.isalnum() or c in "/-_")
        if not folder:
            folder = "uploads"
    else:
        folder = "uploads"
    
    # Generate base filename
    if filename and isinstance(filename, str) and filename.strip():
        base = sanitize_filename(filename.strip())
    else:
        base = str(uuid.uuid4())
    
    # Construct key
    key = f"{folder}/{base}.{ext}"
    return key

