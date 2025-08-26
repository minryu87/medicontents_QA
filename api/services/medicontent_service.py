import os
import sys
import json
import logging
import asyncio
import aiohttp
import io
from datetime import datetime
from typing import Dict, Any, Optional
from pathlib import Path

# agents 폴더를 Python 경로에 추가
current_dir = Path(__file__).parent.parent.parent
agents_path = current_dir / "agents"
sys.path.append(str(agents_path))

# agents 폴더의 절대 경로를 환경변수로 설정
os.environ['AGENTS_BASE_PATH'] = str(agents_path)

from dotenv import load_dotenv
from pyairtable import Api

logger = logging.getLogger(__name__)

# 로그 캡처를 위한 클래스
class LogCapture:
    def __init__(self):
        self.logs = []
        self.original_handlers = {}
    
    def start_capture(self):
        """로그 캡처 시작"""
        # 루트 로거에만 커스텀 핸들러 추가
        self.custom_handler = CustomLogHandler(self.logs)
        logging.getLogger().addHandler(self.custom_handler)
        
        # 주요 로거들에도 핸들러 추가
        loggers_to_capture = [
            'services.medicontent_service',
            'input_agent',
            'plan_agent', 
            'title_agent',
            'content_agent',
            'evaluation_agent'
        ]
        
        for logger_name in loggers_to_capture:
            logger_obj = logging.getLogger(logger_name)
            logger_obj.addHandler(self.custom_handler)
    
    def stop_capture(self):
        """로그 캡처 중지"""
        # 루트 로거에서 핸들러 제거
        if hasattr(self, 'custom_handler'):
            logging.getLogger().removeHandler(self.custom_handler)
        
        # 주요 로거들에서도 핸들러 제거
        loggers_to_capture = [
            'services.medicontent_service',
            'input_agent',
            'plan_agent', 
            'title_agent',
            'content_agent',
            'evaluation_agent'
        ]
        
        for logger_name in loggers_to_capture:
            logger_obj = logging.getLogger(logger_name)
            if hasattr(self, 'custom_handler'):
                logger_obj.removeHandler(self.custom_handler)
    
    def get_logs(self):
        """캡처된 로그 반환"""
        return self.logs.copy()
    
    def add_log(self, level: str, message: str):
        """수동으로 로그 추가"""
        self.logs.append({
            'timestamp': datetime.now().isoformat(),
            'level': level,
            'message': message,
            'logger': 'manual'
        })

class CustomLogHandler(logging.Handler):
    def __init__(self, logs_list):
        super().__init__()
        self.logs_list = logs_list
    
    def emit(self, record):
        try:
            msg = self.format(record)
            self.logs_list.append({
                'timestamp': datetime.now().isoformat(),
                'level': record.levelname,
                'message': msg,
                'logger': record.name
            })
        except Exception:
            self.handleError(record)

# 환경변수 로드
load_dotenv()

async def send_realtime_log(post_id: str, level: str, message: str):
    """실시간 로그를 API로 전송"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post('http://localhost:8000/api/add-log', json={
                'post_id': post_id,
                'log': {
                    'level': level,
                    'message': message
                }
            }) as response:
                if response.status == 200:
                    logger.debug(f"실시간 로그 전송 성공: {message}")
                else:
                    logger.warning(f"실시간 로그 전송 실패: {response.status}")
    except Exception as e:
        logger.warning(f"실시간 로그 전송 중 오류: {e}")

# Airtable 설정
AIRTABLE_API_KEY = 'pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9'
AIRTABLE_BASE_ID = 'appa5Q0PYdL5VY3RK'

api = Api(AIRTABLE_API_KEY)
base = api.base(AIRTABLE_BASE_ID)

# 테이블 객체
table_post_data_requests = base.table('Post Data Requests')
table_medicontent_posts = base.table('Medicontent Posts')

def split_image_descriptions(text: str, count: int) -> list:
    """이미지 설명 분리 함수"""
    if not text.strip():
        return ["" for _ in range(count)]
    
    import re
    parts = re.split(r'[,\n]+', text)
    descriptions = [part.strip() for part in parts if part.strip()]
    
    result = []
    for i in range(count):
        result.append(descriptions[i] if i < len(descriptions) else "")
    return result

async def call_webhook(post_id: str, results: Dict[str, Any]):
    """에이전트 작업 완료 후 웹훅 API 호출"""
    webhook_url = "https://medisales-u45006.vm.elestio.app/webhook/6f545985-77e3-4ee9-8dbf-85ec1d408183"
    
    try:
        payload = {
            "post_id": post_id,
            "status": "agent_completed",  # 에이전트 작업 완료 상태
            "stage": "agent_processing_done",  # 현재 단계
            "results": results,
            "timestamp": datetime.now().isoformat(),
            "next_stage": "html_conversion",  # 다음 단계
            "workflow_id": "medicontent_autoblog_QA_manual"  # 워크플로우 식별자
        }
        
        logger.info(f"웹훅 호출 시작: {post_id}")
        logger.info(f"웹훅 URL: {webhook_url}")
        logger.info(f"웹훅 페이로드: {json.dumps(payload, indent=2, ensure_ascii=False)}")
        
        async with aiohttp.ClientSession() as session:
            async with session.post(webhook_url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
                response_text = await response.text()
                logger.info(f"웹훅 응답 상태: {response.status}")
                logger.info(f"웹훅 응답 헤더: {dict(response.headers)}")
                logger.info(f"웹훅 응답 내용: {response_text}")
                
                if response.status == 200:
                    try:
                        response_data = json.loads(response_text) if response_text else {}
                        logger.info(f"웹훅 호출 성공: {post_id}, 응답: {response_data}")
                        
                        # n8n 응답에서 완료 상태 확인
                        if response_data.get('status') == 'completed':
                            logger.info(f"n8n 워크플로우 완료 확인: {post_id}")
                            await handle_workflow_completion(post_id, response_data)
                        
                        return response_data
                    except json.JSONDecodeError as e:
                        logger.warning(f"웹훅 응답 JSON 파싱 실패: {e}, 응답 텍스트: {response_text}")
                        return {"status": "success", "message": "웹훅 호출됨 (JSON 파싱 실패)"}
                else:
                    logger.warning(f"웹훅 호출 실패 (상태 코드: {response.status}): {post_id}")
                    logger.warning(f"실패 응답: {response_text}")
                    return None
                    
    except asyncio.TimeoutError:
        logger.error(f"웹훅 호출 타임아웃: {post_id}")
        return None
    except Exception as e:
        logger.error(f"웹훅 호출 중 오류 발생: {str(e)}")
        logger.error(f"오류 상세: {type(e).__name__}")
        # 웹훅 호출 실패는 전체 프로세스를 중단시키지 않음
        return None

async def get_random_post_data_request() -> Optional[Dict[str, Any]]:
    """Post Data Requests 테이블에서 랜덤 데이터를 조회합니다."""
    try:
        import random
        # 모든 레코드 조회
        records = table_post_data_requests.all()
        
        if not records:
            raise Exception("Post Data Requests 테이블에 데이터가 없습니다.")
        
        # 랜덤하게 하나 선택
        random_record = random.choice(records)
        
        # 필요한 필드만 추출
        fields = random_record.get('fields', {})
        return {
            'concept_message': fields.get('Concept Message', ''),
            'patient_condition': fields.get('Patient Condition', ''),
            'treatment_process_message': fields.get('Treatment Process Message', ''),
            'treatment_result_message': fields.get('Treatment Result Message', ''),
            'additional_message': fields.get('Additional Message', '')
        }
    except Exception as e:
        logger.error(f"랜덤 Post Data Request 조회 실패: {e}")
        raise Exception(f"랜덤 Post Data Request 조회 실패: {e}")

async def get_post_data_request(post_id: str) -> Optional[Dict[str, Any]]:
    """Post Data Requests 테이블에서 Post ID로 데이터를 조회합니다."""
    try:
        records = table_post_data_requests.all(formula=f"{{Post ID}} = '{post_id}'")
        
        if not records:
            logger.warning(f"Post ID '{post_id}'에 해당하는 레코드를 찾을 수 없습니다.")
            return None
            
        record = records[0]
        fields = record['fields']
        
        return {
            'id': record['id'],
            'post_id': fields.get('Post ID', ''),
            'concept_message': fields.get('Concept Message', ''),
            'patient_condition': fields.get('Patient Condition', ''),
            'treatment_process_message': fields.get('Treatment Process Message', ''),
            'treatment_result_message': fields.get('Treatment Result Message', ''),
            'additional_message': fields.get('Additional Message', ''),
            'before_images': fields.get('Before Images', []),
            'process_images': fields.get('Process Images', []),
            'after_images': fields.get('After Images', []),
            'before_images_texts': fields.get('Before Images Texts', ''),
            'process_images_texts': fields.get('Process Images Texts', ''),
            'after_images_texts': fields.get('After Images Texts', ''),
            'status': fields.get('Status', '대기')
        }
        
    except Exception as e:
        logger.error(f"Post Data Request 조회 실패: {str(e)}")
        raise

async def update_post_data_request_status(record_id: str, status: str, results: Dict = None):
    """Post Data Requests 상태 및 결과 업데이트"""
    try:
        update_data = {
            'Status': status,
        }
        
        if results:
            if 'title' in results:
                update_data['Title'] = results['title']
            if 'content' in results:
                update_data['Content'] = results['content']
            if 'plan' in results:
                update_data['Plan'] = json.dumps(results['plan'], ensure_ascii=False)
            if 'evaluation' in results:
                update_data['Evaluation'] = json.dumps(results['evaluation'], ensure_ascii=False)
        
        table_post_data_requests.update(record_id, update_data)
        logger.info(f"상태 업데이트 완료: {record_id} -> {status}")
        
    except Exception as e:
        logger.error(f"상태 업데이트 실패: {e}")
        raise

async def update_medicontent_post_status(post_id: str, status: str):
    """Medicontent Posts 테이블의 상태 업데이트"""
    try:
        medicontent_records = table_medicontent_posts.all(formula=f"{{Post Id}} = '{post_id}'")
        
        if not medicontent_records:
            logger.warning(f"Post ID '{post_id}'에 해당하는 Medicontent Posts 레코드를 찾을 수 없습니다.")
            return
            
        record = medicontent_records[0]
        record_id = record['id']
        
        update_data = {
            'Status': status,
        }
        
        table_medicontent_posts.update(record_id, update_data)
        logger.info(f"Medicontent Posts 상태 업데이트 완료: {record_id} (Post ID: {post_id}) → {status}")
        
    except Exception as e:
        logger.error(f"Medicontent Posts 상태 업데이트 실패: {str(e)}")
        raise

async def process_post_data_request(post_id: str) -> Dict[str, Any]:
    """Post Data Request를 처리하고 agent를 실행합니다."""
    record_id = None
    
    # 로그 캡처 시작
    log_capture = LogCapture()
    log_capture.start_capture()
    
    try:
        log_capture.add_log("INFO", f"Post ID '{post_id}' 처리 시작")
        
        # 1단계: Post Data Request 조회
        log_capture.add_log("INFO", f"Step 1: Post ID '{post_id}' 데이터 조회...")
        logger.info(f"Step 1: Post ID '{post_id}' 데이터 조회...")
        post_data = await get_post_data_request(post_id)
        
        if not post_data:
            raise Exception(f"Post ID '{post_id}'에 해당하는 데이터를 찾을 수 없습니다.")
        
        record_id = post_data['id']
        
        # 2단계: 상태를 '처리 중'으로 변경
        log_capture.add_log("INFO", "Step 2: 상태를 '처리 중'으로 변경...")
        logger.info("Step 2: 상태를 '처리 중'으로 변경...")
        await update_post_data_request_status(record_id, '처리 중')
        log_capture.add_log("INFO", "Post Data Request 상태를 '처리 중'으로 변경 완료")
        
        # 3단계: 병원 정보 조회
        log_capture.add_log("INFO", "Step 3: 병원 정보 조회 시작...")
        hospital_table = base.table('Hospital')
        try:
            hospital_records = hospital_table.all()
            if hospital_records:
                hospital_record = hospital_records[0]['fields']
                hospital_name = hospital_record.get('Hospital Name', '병원')
                hospital_address = hospital_record.get('Address', '')
                hospital_phone = hospital_record.get('Phone', '')
                log_capture.add_log("INFO", f"병원 정보 조회 완료: {hospital_name}")
            else:
                raise Exception("Hospital 테이블에 데이터가 없음")
        except Exception as e:
            log_capture.add_log("WARNING", f"Hospital 테이블 조회 실패: {e}, 기본값 사용")
            logger.warning(f"Hospital 테이블 조회 실패: {e}, 기본값 사용")
            hospital_name = "내이튼치과의원"
            hospital_address = "B동 507호 라스플로레스 경기도 화성시 동탄대로 537"
            hospital_phone = "031-526-2246"
        
        # 4단계: UI 데이터를 InputAgent 형식으로 변환
        log_capture.add_log("INFO", "Step 4: UI 데이터를 InputAgent 형식으로 변환...")
        input_data = {
            "hospital": {
                "name": hospital_name,
                "save_name": hospital_name,
                "address": hospital_address,
                "phone": hospital_phone
            },
            "category": "일반진료",
            "question1_concept": post_data['concept_message'],
            "question2_condition": post_data['patient_condition'],
            "question3_visit_images": [
                {"filename": img, "description": desc}
                for img, desc in zip(
                    post_data['before_images'],
                    split_image_descriptions(post_data['before_images_texts'], len(post_data['before_images']))
                )
            ],
            "question4_treatment": post_data['treatment_process_message'],
            "question5_therapy_images": [
                {"filename": img, "description": desc}
                for img, desc in zip(
                    post_data['process_images'],
                    split_image_descriptions(post_data['process_images_texts'], len(post_data['process_images']))
                )
            ],
            "question6_result": post_data['treatment_result_message'],
            "question7_result_images": [
                {"filename": img, "description": desc}
                for img, desc in zip(
                    post_data['after_images'],
                    split_image_descriptions(post_data['after_images_texts'], len(post_data['after_images']))
                )
            ],
            "question8_extra": post_data['additional_message'],
            "include_tooth_numbers": False,
            "tooth_numbers": [],
            "persona_candidates": [],
            "representative_persona": ""
        }
        log_capture.add_log("INFO", "InputAgent 입력 데이터 구성 완료")
        
        # 5단계: AI 에이전트들 import 및 실행
        log_capture.add_log("INFO", "Step 5: AI 에이전트 모듈 import 시작...")
        try:
            from input_agent import InputAgent
            from plan_agent import main as plan_agent_main
            from title_agent import run as title_agent_run
            from content_agent import run as content_agent_run
            log_capture.add_log("INFO", "AI 에이전트 모듈 import 완료")
        except ImportError as e:
            log_capture.add_log("ERROR", f"AI 에이전트 import 실패: {e}")
            logger.error(f"AI 에이전트 import 실패: {e}")
            raise Exception("AI 에이전트 모듈을 찾을 수 없습니다. agents 폴더를 확인해주세요.")
        
        # 6단계: 전체 파이프라인 실행
        log_capture.add_log("INFO", "Step 3: InputAgent 실행 시작...")
        await send_realtime_log(post_id, "INFO", "Step 3: InputAgent 실행 시작...")
        logger.info("Step 3: InputAgent 실행...")
        input_agent = InputAgent(input_data=input_data)
        input_result = input_agent.collect(mode="use")
        log_capture.add_log("INFO", "InputAgent 실행 완료")
        await send_realtime_log(post_id, "INFO", "InputAgent 실행 완료")
        
        log_capture.add_log("INFO", "Step 4: PlanAgent 실행 시작...")
        await send_realtime_log(post_id, "INFO", "Step 4: PlanAgent 실행 시작...")
        logger.info("Step 4: PlanAgent 실행...")
        plan = plan_agent_main(mode='use', input_data=input_result)
        log_capture.add_log("INFO", "PlanAgent 실행 완료")
        await send_realtime_log(post_id, "INFO", "PlanAgent 실행 완료")
        
        log_capture.add_log("INFO", "Step 5: TitleAgent 실행 시작...")
        await send_realtime_log(post_id, "INFO", "Step 5: TitleAgent 실행 시작...")
        logger.info("Step 5: TitleAgent 실행...")
        title_result = title_agent_run(plan=plan, mode='use')
        title = title_result.get('selected', {}).get('title', '')
        log_capture.add_log("INFO", f"TitleAgent 실행 완료 - 생성된 제목: {title}")
        await send_realtime_log(post_id, "INFO", f"TitleAgent 실행 완료 - 생성된 제목: {title}")
        
        log_capture.add_log("INFO", "Step 6: ContentAgent 실행 시작...")
        await send_realtime_log(post_id, "INFO", "Step 6: ContentAgent 실행 시작...")
        logger.info("Step 6: ContentAgent 실행...")
        content_result = content_agent_run(mode='use')
        content = content_result
        log_capture.add_log("INFO", "ContentAgent 실행 완료")
        await send_realtime_log(post_id, "INFO", "ContentAgent 실행 완료")
        
        # 7단계: 전체 글 생성
        log_capture.add_log("INFO", "전체 글 생성 시작...")
        try:
            from content_agent import format_full_article
            full_article = format_full_article(content, input_data={**input_result, **plan, 'title': title})
            log_capture.add_log("INFO", "format_full_article 함수로 전체 글 생성 완료")
        except ImportError:
            full_article = content if isinstance(content, str) else str(content)
            log_capture.add_log("WARNING", "format_full_article 함수를 찾을 수 없어 기본 콘텐츠 사용")
        
        log_capture.add_log("INFO", "텍스트 생성 완료!")
        logger.info("텍스트 생성 완료!")
        
        # 8단계: 결과를 Post Data Requests에 업데이트 (상태: 완료)
        log_capture.add_log("INFO", "결과 데이터 구성 시작...")
        results = {
            "title": title,
            "content": full_article,
            "plan": plan,
            "evaluation": {
                "plan_evaluation": "계획 생성 완료",
                "title_evaluation": "제목 생성 완료", 
                "content_evaluation": "콘텐츠 생성 완료"
            }
        }
        log_capture.add_log("INFO", f"결과 데이터 구성 완료 - 제목: {title[:50]}...")
        
        log_capture.add_log("INFO", "Step 7: 결과를 Airtable에 저장...")
        logger.info("Step 7: 결과를 Airtable에 저장...")
        await update_post_data_request_status(record_id, '완료', results)
        log_capture.add_log("INFO", "Post Data Requests 테이블 업데이트 완료")
        
        # 9단계: Medicontent Posts 상태를 '리걸케어 작업 중'으로 업데이트
        log_capture.add_log("INFO", "Medicontent Posts 상태 업데이트 시작...")
        await update_medicontent_post_status(post_id, '리걸케어 작업 중')
        log_capture.add_log("INFO", "Medicontent Posts 상태를 '리걸케어 작업 중'으로 업데이트 완료")
        
        # 10단계: 웹훅 API 호출
        log_capture.add_log("INFO", "Step 8: 웹훅 API 호출...")
        logger.info("Step 8: 웹훅 API 호출...")
        webhook_response = await call_webhook(post_id, results)
        
        # 11단계: n8n 응답 확인 및 완료 처리
        if webhook_response and webhook_response.get('status') == 'completed':
            log_capture.add_log("INFO", "n8n 워크플로우 완료 확인됨")
            logger.info("n8n 워크플로우 완료 확인됨")
            # 여기서 다음 작업을 진행할 수 있습니다
        else:
            log_capture.add_log("INFO", "n8n 워크플로우 진행 중 또는 응답 대기 중")
            logger.info("n8n 워크플로우 진행 중 또는 응답 대기 중")
        
        # 로그 캡처 중지
        log_capture.stop_capture()
        captured_logs = log_capture.get_logs()
        
        # 디버그: 캡처된 로그 확인
        logger.info(f"캡처된 로그 개수: {len(captured_logs)}")
        for i, log in enumerate(captured_logs[:5]):  # 처음 5개만 출력
            logger.info(f"로그 {i+1}: {log}")
        
        return {
            "status": "success",
            "post_id": post_id,
            "record_id": record_id,
            "results": results,
            "logs": captured_logs,
            "message": "메디컨텐츠 생성 및 DB 저장 완료!"
        }
        
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"오류 발생: {str(e)}")
        logger.error(f"상세: {error_details}")
        
        # 로그 캡처 중지
        log_capture.stop_capture()
        captured_logs = log_capture.get_logs()
        
        # 오류 발생 시 상태를 '대기'로 되돌리기
        if record_id:
            try:
                await update_post_data_request_status(record_id, '대기')
            except:
                pass
        
        # 오류 정보와 함께 로그도 포함하여 예외 발생
        error_response = {
            "status": "error",
            "message": f"텍스트 생성 실패: {str(e)}",
            "logs": captured_logs,
            "error_details": error_details
        }
        raise Exception(json.dumps(error_response))
