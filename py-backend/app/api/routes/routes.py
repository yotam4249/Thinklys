from fastapi import APIRouter


api = APIRouter()

@api.get("/hello")
async def hello(): return {"msg": "Hello from FastAPI"}