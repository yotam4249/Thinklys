from fastapi import APIRouter
from app.api.routes.auth_routes import router as auth_router

api = APIRouter()

# Include auth routes
api.include_router(auth_router)

@api.get("/hello")
async def hello(): 
    return {"msg": "Hello from FastAPI"}