from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import asyncio
from typing import Optional, Dict, Any
import logging
from datetime import datetime

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

class N8nCompletionRequest(BaseModel):
    post_id: str
    workflow_id: str
    timestamp: str
    n8n_result: str

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

@app.post("/api/n8n-completion")
async def n8n_completion(request: N8nCompletionRequest):
    """n8n 워크플로우 완료 후 호출되는 API"""
    try:
        logger.info(f"n8n 완료 요청 수신: {request.post_id}, 워크플로우: {request.workflow_id}")
        
        # 1단계: Airtable 상태 확인
        from services.medicontent_service import get_post_data_request, table_medicontent_posts
        
        # Post Data Requests 상태 확인
        post_data = await get_post_data_request(request.post_id)
        if not post_data:
            logger.warning(f"Post Data Request를 찾을 수 없음: {request.post_id}")
            return {
                "status": "error",
                "message": "Post Data Request not found",
                "post_id": request.post_id
            }
        
        # Medicontent Posts 상태 확인
        medicontent_records = table_medicontent_posts.all(formula=f"{{Post Id}} = '{request.post_id}'")
        if not medicontent_records:
            logger.warning(f"Medicontent Post를 찾을 수 없음: {request.post_id}")
            return {
                "status": "error", 
                "message": "Medicontent Post not found",
                "post_id": request.post_id
            }
        
        medicontent_status = medicontent_records[0]['fields'].get('Status', '')
        post_data_status = post_data.get('status', '')
        
        # 2단계: 완료 상태 확인
        is_fully_completed = (
            post_data_status == '완료' and 
            medicontent_status == '작업 완료'
        )
        
        if is_fully_completed:
            logger.info(f"전체 워크플로우 완료 확인: {request.post_id}")
            
            # 3단계: 후속 작업 실행
            await handle_post_completion(request.post_id, request)
            
            return {
                "status": "success",
                "message": "워크플로우 완료 확인됨",
                "post_id": request.post_id,
                "is_completed": True,
                "post_data_status": post_data_status,
                "medicontent_status": medicontent_status
            }
        else:
            logger.warning(f"워크플로우 미완료: {request.post_id}, Post Data: {post_data_status}, Medicontent: {medicontent_status}")
            return {
                "status": "pending",
                "message": "워크플로우 진행 중",
                "post_id": request.post_id,
                "is_completed": False,
                "post_data_status": post_data_status,
                "medicontent_status": medicontent_status
            }
            
    except Exception as e:
        logger.error(f"n8n 완료 처리 중 오류: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def handle_post_completion(post_id: str, request: N8nCompletionRequest):
    """포스트 완료 후 후속 작업 처리"""
    try:
        logger.info(f"후속 작업 시작: {post_id}")
        
        # 완료 로그 저장
        completion_log = {
            "post_id": post_id,
            "workflow_id": request.workflow_id,
            "completion_time": request.timestamp,
            "status": "fully_completed",
            "n8n_result": request.n8n_result
        }
        
        logger.info(f"완료 로그: {completion_log}")
        
        # 여기에 후속 작업들을 추가할 수 있습니다:
        
        # 1. Slack 알림 전송
        # await send_slack_notification(post_id, "메디컨텐츠 생성 완료!")
        
        # 2. 다른 시스템에 데이터 전송
        # await send_to_cms_system(post_id, request.n8n_result)
        
        # 3. 추가 분석 작업
        # await run_content_analysis(post_id)
        
        # 4. 다음 워크플로우 트리거
        # await trigger_next_workflow(post_id)
        
        # 5. 완료 통계 업데이트
        # await update_completion_stats(post_id)
        
        logger.info(f"후속 작업 완료: {post_id}")
        
    except Exception as e:
        logger.error(f"후속 작업 처리 중 오류: {str(e)}")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
