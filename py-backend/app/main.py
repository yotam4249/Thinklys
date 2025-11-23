from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import (
    http_exception_handler,
    request_validation_exception_handler,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from contextlib import asynccontextmanager
import json
import traceback

from app.core.config import settings
from app.core.db import get_db
from app.core.redis import get_redis, close_redis
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.routes import api
from app.services.socket_service import sio
import socketio


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan - startup and shutdown."""
    # Startup
    await get_redis()  # Initialize Redis connection
    
    # Start quiz response consumer
    from app.api.routes.quiz_routes import start_quiz_response_consumer
    await start_quiz_response_consumer()
    
    yield
    # Shutdown
    await close_redis()
    
    # Close Kafka connections
    from app.services.kafka_service import kafka_service
    kafka_service.close()


app = FastAPI(title=settings.APP_NAME, lifespan=lifespan)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=["*"])

# Parse CORS origins
cors_origins = settings.CORS_ALLOWED_ORIGINS
if isinstance(cors_origins, str):
    try:
        cors_origins = json.loads(cors_origins)
    except json.JSONDecodeError:
        cors_origins = [origin.strip() for origin in cors_origins.split(",") if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if isinstance(cors_origins, list) else [],
    allow_origin_regex=settings.CORS_ALLOWED_REGEX,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def dev_log(req: Request, call_next):
    if settings.APP_ENV != "production":
        print(f"[{req.method}] {req.url.path}")
    return await call_next(req)


@app.get("/", response_class=PlainTextResponse)
async def root():
    return "OK"


@app.get("/health")
async def health(db_session: AsyncSession = Depends(get_db)):
    result = await db_session.execute(text("SELECT 1"))
    ok = result.scalar() == 1
    return JSONResponse({"ok": ok})


app.include_router(api, prefix="/api")

# Exception handlers to ensure CORS headers are included in error responses
# (Must be registered before wrapping with Socket.IO)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Global exception handler to ensure CORS headers are included."""
    print(f"Unhandled exception: {exc}")
    if settings.APP_ENV != "production":
        traceback.print_exc()
    
    # Get origin from request
    origin = request.headers.get("origin")
    
    # Check if origin is allowed
    allowed_origins = cors_origins if isinstance(cors_origins, list) else []
    is_allowed = False
    if origin:
        # Check exact match
        if origin in allowed_origins:
            is_allowed = True
        # Check regex match
        elif settings.CORS_ALLOWED_REGEX:
            import re
            if re.match(settings.CORS_ALLOWED_REGEX, origin):
                is_allowed = True
    
    # Build CORS headers
    cors_headers = {}
    if is_allowed:
        cors_headers["Access-Control-Allow-Origin"] = origin
        cors_headers["Access-Control-Allow-Credentials"] = "true"
    cors_headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    cors_headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    
    # Return error response with CORS headers
    return JSONResponse(
        status_code=500,
        content={"code": "SERVER_ERROR", "message": "Internal server error"},
        headers=cors_headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors with CORS headers."""
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(IntegrityError)
async def integrity_error_handler(request: Request, exc: IntegrityError):
    """Handle database integrity errors with CORS headers."""
    print(f"Integrity error: {exc}")
    if settings.APP_ENV != "production":
        traceback.print_exc()
    
    # Get origin from request
    origin = request.headers.get("origin")
    
    # Check if origin is allowed
    allowed_origins = cors_origins if isinstance(cors_origins, list) else []
    is_allowed = False
    if origin:
        if origin in allowed_origins:
            is_allowed = True
        elif settings.CORS_ALLOWED_REGEX:
            import re
            if re.match(settings.CORS_ALLOWED_REGEX, origin):
                is_allowed = True
    
    # Build CORS headers
    cors_headers = {}
    if is_allowed:
        cors_headers["Access-Control-Allow-Origin"] = origin
        cors_headers["Access-Control-Allow-Credentials"] = "true"
    cors_headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    cors_headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    
    # Extract error message
    error_msg = str(exc.orig) if hasattr(exc, 'orig') else str(exc)
    error_code = "BAD_REQUEST"
    if "not-null" in error_msg.lower() or "null value" in error_msg.lower():
        error_code = "BAD_REQUEST"
    elif "unique" in error_msg.lower() or "duplicate" in error_msg.lower():
        error_code = "CONFLICT"
    
    return JSONResponse(
        status_code=400 if error_code == "BAD_REQUEST" else 409,
        content={"code": error_code, "message": "Database constraint violation"},
        headers=cors_headers,
    )

# Mount Socket.IO app - wrap FastAPI app with Socket.IO
# This must be done AFTER all routes and exception handlers are registered
app = socketio.ASGIApp(sio, app)
