from fastapi import APIRouter
from app.api.routes.auth_routes import router as auth_router
from app.api.routes.chat_routes import router as chat_router
from app.api.routes.files_routes import router as files_router
from app.api.routes.quiz_routes import router as quiz_router
from app.api.routes.qa_routes import router as qa_router

api = APIRouter()

# Include routes
api.include_router(auth_router)
api.include_router(chat_router)
api.include_router(files_router)
api.include_router(quiz_router)
api.include_router(qa_router)

@api.get("/hello")
async def hello(): 
    return {"msg": "Hello from FastAPI"}