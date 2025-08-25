from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
from typing import Optional
import logging

from services.medicontent_service import process_post_data_request

# 로깅 설정
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="메디컨텐츠 QA API", version="1.0.0")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ProcessRequest(BaseModel):
    post_id: str

@app.get("/")
async def root():
    return {"message": "메디컨텐츠 QA API가 실행 중입니다."}

@app.post("/api/process-post")
async def process_post(request: ProcessRequest):
    """Post Data Requests 테이블에서 데이터를 조회하고 agent를 실행합니다."""
    try:
        logger.info(f"Post ID {request.post_id}에 대한 처리 시작")
        
        # 비동기로 agent 처리 실행
        result = await process_post_data_request(request.post_id)
        
        return {
            "status": "success",
            "post_id": request.post_id,
            "result": result
        }
        
    except Exception as e:
        logger.error(f"Post 처리 중 오류 발생: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/health")
async def health_check():
    """헬스 체크 엔드포인트"""
    return {"status": "healthy"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
