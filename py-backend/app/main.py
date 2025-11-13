
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse
from app.core.config import settings
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.routes import api

app = FastAPI(title = settings.APP_NAME)
app.add_middleware(ProxyHeadersMiddleware,trusted_hosts=["*"])

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ALLOWED_ORIGINS,
    allow_origin_regex=settings.CORS_ALLOWED_REGEX,
    allow_credentials=True,
    allow_methods=["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
    allow_headers=["Content-Type","Authorization"],
)

@app.middleware("http")
async def dev_log(req: Request, call_next):
    if settings.APP_ENV != "production": print(f"[{req.method}] {req.url.path}")
    return await call_next(req)

@app.get("/",response_class=PlainTextResponse)
async def root(): 
    return "OK"

@app.get("/health")
async def health(): 
    return JSONResponse({"ok": True})

app.include_router(api, prefix="/api")