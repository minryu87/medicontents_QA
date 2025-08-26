# -*- coding: utf-8 -*-
"""
EvaluationAgent (FINAL)
- 프롬프트: test_prompt/llm_evaluation_prompt.txt, test_prompt/llm_regeneration_prompt.txt
- 로그: 기본 test_logs/test/ (CLI로 변경 가능)
- 기준: test_data/evaluation_criteria.json
- 체크리스트 CSV: test_data/medical_ad_checklist.csv (또는 /mnt/test_data/medical_ad_checklist.csv)
- 리포트 MD: test_data/medical-ad-report.md (또는 /mnt/test_data/medical-ad-report.md)

기능 요약
1) title/content 강인 추출(재귀)
2) 규칙 스코어러: medical_ad_checklist.csv → 정규식/키워드 자동화 → rule_score(0~5)
3) LLM 평가: 평가 프롬프트(JSON) → llm_score(0~5)
4) 스코어 융합: final_score = max(rule_score, llm_score)
5) 우선순위 가중 총점: medical-ad-report.md 테이블 기반(weighted_total 0~100)
6) 임계 비교: evaluation_criteria.json(엄격/표준/유연) → 위반 판정
7) 재생성 프롬프트 적용 → 재평가, Regen-Fit(0~100) 산출:
   - risk_reduction_rate (위반해소율)
   - guideline_adherence (권고 반영율)
   - flow_stability (흐름 안정성)

CLI
- --criteria (엄격|표준|유연), --max_loops, --auto-yes, --log-dir, --pattern, --debug
- --csv (--csv-path), --report (--report-path)

필수: .env에 GEMINI_API_KEY
"""

import os
import re
import csv
import json
import argparse
from pathlib import Path
from datetime import datetime
from typing import Any, Dict, List, Tuple, Union, Iterable

import google.generativeai as genai
from dotenv import load_dotenv



# ===== 경로 기본 =====
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOG_DIR = ROOT / "app/test_logs" / "use"
PROMPTS_DIR = Path(os.environ.get('AGENTS_BASE_PATH', Path(__file__).parent)) / "utils" / "test_prompt"
DATA_DIR = Path(__file__).parent / "utils"

# ===== HTML 파싱 함수 =====
def extract_title_and_content_from_html(html_file_path: str) -> tuple[str, str]:
    """HTML 파일에서 제목(텍스트)과 본문(HTML 코드)을 추출"""
    try:
        with open(html_file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()
        
        # BeautifulSoup을 사용한 파싱
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # 제목 추출 (h1, title 태그 등에서)
            title = ""
            if soup.find('h1'):
                title = soup.find('h1').get_text(strip=True)
            elif soup.find('title'):
                title = soup.find('title').get_text(strip=True)
            
            # 본문 추출 (HTML 코드 그대로)
            content = html_content
            
            # HTML 코드는 그대로 유지
            
            print(f"📝 HTML에서 추출:")
            print(f"   제목: {title[:50]}..." if len(title) > 50 else f"   제목: {title}")
            print(f"   본문 HTML 크기: {len(content)}자 (HTML 코드 포함)")
            
            return title, content
            
        except ImportError:
            print("⚠️ BeautifulSoup이 없어 간단한 정규식으로 파싱합니다.")
            # BeautifulSoup이 없는 경우 간단한 정규식 사용
            title_match = re.search(r'<h1[^>]*>(.*?)</h1>', html_content, re.IGNORECASE | re.DOTALL)
            title = title_match.group(1).strip() if title_match else ""
            
            # Content는 HTML 코드 그대로 (body 태그 내용 또는 전체)
            body_match = re.search(r'<body[^>]*>(.*?)</body>', html_content, re.IGNORECASE | re.DOTALL)
            if body_match:
                content = f"<body>{body_match.group(1)}</body>"
            else:
                # body가 없으면 전체 HTML
                content = html_content
            
            return title, content
            
    except Exception as e:
        print(f"❌ HTML 파싱 실패: {str(e)}")
        return "", ""

# ===== UI Checklist 로그 생성 함수 =====
def generate_ui_checklist_logs(evaluation_data: Dict[str, Any], base_log_path: str):
    """evaluation 로그에서 SEO/의료법 UI checklist 로그 생성"""
    
    criteria = evaluation_data.get('modes', {}).get('criteria', '')
    by_item = evaluation_data.get('scores', {}).get('by_item', {})
    
    # criteria로 SEO vs 의료법 구분
    is_legal = criteria in ['엄격', '표준', '유연']
    is_seo = criteria in ['우수', '양호', '보통']
    
    # UI checklist 형태로 변환
    checklist = []
    for item_id, item_data in by_item.items():
        checklist_item = {
            "name": item_data.get("name"),                    # 항목명 (있음)
            "threshold": item_data.get("threshold"),          # 기준점수 (있음)
            "grade": item_data.get("grade", None),           # 포스트 검토 결과 (없음, null)
            "final_score": item_data.get("final_score"),     # 점수 (있음)
            "pass_status": item_data.get("pass_status", None) # 통과 (없음, null)
        }
        checklist.append(checklist_item)
    
    # 파일명 생성
    if is_seo:
        ui_log_path = base_log_path.replace('_evaluation.json', '_seo_ui_checklist.json')
        log_type = "SEO"
    elif is_legal:
        ui_log_path = base_log_path.replace('_evaluation.json', '_legal_ui_checklist.json')
        log_type = "의료법"
    else:
        print(f"알 수 없는 criteria: {criteria}")
        return None
    
    # UI checklist 로그 저장
    try:
        with open(ui_log_path, 'w', encoding='utf-8') as f:
            json.dump(checklist, f, ensure_ascii=False, indent=2)
        
        print(f"✅ {log_type} UI checklist 로그 저장: {Path(ui_log_path).name}")
        print(f"📊 {len(checklist)}개 항목, criteria: {criteria}")
        
        return ui_log_path
        
    except Exception as e:
        print(f"❌ UI checklist 로그 저장 실패: {e}")
        return None

# ===== DB 업데이트 함수 =====
def auto_update_medicontent_posts(evaluation_data: Dict[str, Any], evaluation_file_path: str) -> bool:
    """evaluation 완료 후 자동으로 Medicontent Posts 테이블 업데이트"""
    try:
        print("🔄 Evaluation 완료 - 자동 DB 업데이트 시작...")
        
        # evaluation 데이터에서 필요한 정보 추출 (criteria, score만)
        criteria = evaluation_data.get("modes", {}).get("criteria", "")
        weighted_total = evaluation_data.get("scores", {}).get("weighted_total", 0)
        
        # 타임스탬프 추출 (파일명이나 경로에서)
        timestamp = None
        source_log = evaluation_data.get("input", {}).get("source_log", "")
        
        # source_log에서 타임스탬프 추출 시도
        if source_log:
            import re
            timestamp_match = re.search(r'(\d{8}_\d{6})', source_log)
            if timestamp_match:
                timestamp = timestamp_match.group(1)
        
        # 파일명에서도 추출 시도
        if not timestamp:
            eval_filename = Path(evaluation_file_path).stem
            timestamp_match = re.search(r'(\d{8}_\d{6})', eval_filename)
            if timestamp_match:
                timestamp = timestamp_match.group(1)
        
        if not timestamp:
            print("⚠️ 타임스탬프를 찾을 수 없어 DB 업데이트를 건너뜁니다.")
            return False
        
        print(f"🔍 추출된 타임스탬프: {timestamp}")
        
        # criteria에 따라 SEO Score vs Legal Score 구분
        is_legal_score = criteria in ["엄격", "표준", "유연"]
        is_seo_score = criteria in ["우수", "양호", "보통"]
        
        # 같은 타임스탬프로 생성된 content.json 찾기
        eval_dir = Path(evaluation_file_path).parent
        content_pattern = f"{timestamp}_content.json"
        content_files = list(eval_dir.glob(f"**/{content_pattern}"))
        
        if not content_files:
            # 상위 디렉토리에서도 검색
            parent_dirs = [eval_dir.parent, eval_dir.parent.parent]
            for parent_dir in parent_dirs:
                content_files = list(parent_dir.glob(f"**/{content_pattern}"))
                if content_files:
                    break
        
        if not content_files:
            print(f"⚠️ 타임스탬프 {timestamp}에 해당하는 content.json을 찾을 수 없습니다.")
            return False
        
        content_file = content_files[0]
        print(f"✅ Content 파일 발견: {content_file}")
        
        # 같은 타임스탬프로 생성된 HTML 파일 찾기
        html_files = []
        html_patterns = [
            f"{timestamp}.html",
            f"{timestamp}_content.html", 
            f"{timestamp}_result.html"
        ]
        
        for pattern in html_patterns:
            html_files.extend(list(eval_dir.glob(f"**/{pattern}")))
            if not html_files:
                # 상위 디렉토리에서도 검색
                parent_dirs = [eval_dir.parent, eval_dir.parent.parent]
                for parent_dir in parent_dirs:
                    html_files.extend(list(parent_dir.glob(f"**/{pattern}")))
                    if html_files:
                        break
            if html_files:
                break
        
        html_file = html_files[0] if html_files else None
        if html_file:
            print(f"✅ HTML 파일 발견: {html_file}")
        else:
            print(f"⚠️ 타임스탬프 {timestamp}에 해당하는 HTML 파일을 찾을 수 없습니다.")
            print(f"   검색한 패턴: {html_patterns}")
        
        # content.json에서 input_source 추출
        try:
            with open(content_file, 'r', encoding='utf-8') as f:
                content_data = json.load(f)
            
            input_source = content_data.get("meta", {}).get("input_source", "")
            
            if not input_source:
                print(f"⚠️ content.json에서 input_source를 찾을 수 없습니다.")
                return False
            
            print(f"🔍 Content에서 input_source 추출: {input_source}")
            
            # input_source 경로를 절대 경로로 변환
            if not Path(input_source).is_absolute():
                # 상대 경로인 경우 ROOT 기준으로 변환
                input_log_file = ROOT / input_source
            else:
                input_log_file = Path(input_source)
            
            print(f"🔍 Input 로그 파일 경로: {input_log_file}")
            
        except Exception as e:
            print(f"❌ content.json 읽기 실패: {str(e)}")
            return False
        
        # input_logs.json에서 원래 타임스탬프2 추출
        try:
            with open(input_log_file, 'r', encoding='utf-8') as f:
                input_logs = json.load(f)
            print(f"✅ input_logs.json 로드 완료: {input_log_file}")
            
            # input_logs.json에서 타임스탬프2 추출 (원래 시작 시점의 타임스탬프)
            original_timestamp = None
            
            # input_logs가 배열인 경우
            if isinstance(input_logs, list) and input_logs:
                for log_entry in input_logs:
                    if isinstance(log_entry, dict):
                        # created_at을 최우선으로 찾기
                        for key in ['created_at', 'timestamp', 'updated_at', 'time']:
                            if key in log_entry:
                                original_timestamp = str(log_entry[key])
                                timestamp_type = key  # 어떤 필드에서 가져왔는지 기록
                                print(f"🔍 Input 로그에서 '{key}' 필드 사용: {original_timestamp}")
                                break
                        if original_timestamp:
                            break
            
            # input_logs가 딕셔너리인 경우
            elif isinstance(input_logs, dict):
                for key in ['created_at', 'timestamp', 'updated_at', 'time']:
                    if key in input_logs:
                        original_timestamp = str(input_logs[key])
                        timestamp_type = key  # 어떤 필드에서 가져왔는지 기록
                        print(f"🔍 Input 로그에서 '{key}' 필드 사용: {original_timestamp}")
                        break
            
            if not original_timestamp:
                print(f"⚠️ input_logs.json에서 타임스탬프를 찾을 수 없습니다.")
                print(f"   파일 내용 미리보기: {str(input_logs)[:300]}...")
                return False
            
            print(f"🔍 Input 로그에서 원래 타임스탬프2 추출: {original_timestamp}")
            
        except Exception as e:
            print(f"❌ input_logs.json 읽기 실패: {str(e)}")
            return False
        
        # Medicontent Posts 테이블에서 타임스탬프2와 Updated At 매칭
        load_dotenv()
        
        try:
            from pyairtable import Api
            
            api = Api(os.getenv('AIRTABLE_API_KEY'))
            table = api.table(os.getenv('AIRTABLE_BASE_ID'), 'Medicontent Posts')
            
            # 모든 레코드를 가져와서 원래 타임스탬프2와 Updated At 매칭
            print(f"🔍 Medicontent Posts에서 Updated At 시간이 원래 타임스탬프2 '{original_timestamp}'와 매칭되는 레코드 검색...")
            all_records = table.all()
            print(f"📊 총 {len(all_records)}개의 레코드를 가져왔습니다.")
            
            # 원래 타임스탬프2를 ISO 형식으로 변환 (YYYY-MM-DD HH:MM)
            iso_timestamp = None
            
            # original_timestamp가 20250821_165228 형식인 경우
            if '_' in original_timestamp and len(original_timestamp) == 15:
                date_part = original_timestamp[:8]  # 20250821
                time_part = original_timestamp[9:]  # 165228
                hour = time_part[:2]       # 16
                minute = time_part[2:4]    # 52
                
                # ISO 형식으로 변환: YYYY-MM-DD HH:MM (초 제외)
                iso_timestamp = f"{original_timestamp[:4]}-{original_timestamp[4:6]}-{original_timestamp[6:8]} {hour}:{minute}"
                
            else:
                # 다른 형식의 경우 YYYY-MM-DD HH:MM 형식으로 변환 (초 제거)
                import re
                # YYYY-MM-DD HH:MM:SS 형식에서 초 제거
                if re.match(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', original_timestamp):
                    iso_timestamp = original_timestamp[:16]  # YYYY-MM-DD HH:MM까지만
                else:
                    iso_timestamp = original_timestamp
                
            print(f"🔄 ISO 형식으로 변환: {original_timestamp} → {iso_timestamp}")
            
            matched_record = None
            original_post_id = None
            
            # 1차: Created At 우선 매칭 (생성 시간은 변경되지 않음)
            print(f"🔄 1차 시도: Created At 매칭...")
            for i, record in enumerate(all_records):
                created_at = record['fields'].get('Created At', '')
                record_post_id = record['fields'].get('Post Id', '')
                
                # 디버깅: 처음 몇 개 레코드의 상세 정보 출력
                if i < 3:
                    print(f"🔍 레코드 {i+1}: PostID='{record_post_id}', Created At='{created_at}'")
                
                if created_at and iso_timestamp:
                    try:
                        from datetime import datetime, timezone, timedelta
                        # Created At을 한국 시간대로 변환
                        dt_utc = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                        korea_tz = timezone(timedelta(hours=9))
                        dt_korea = dt_utc.astimezone(korea_tz)
                        airtable_formatted = dt_korea.strftime('%Y-%m-%d %H:%M')
                        
                        if i < 3:
                            print(f"   📅 Created At 변환: '{created_at}' → '{airtable_formatted}' (찾는값: '{iso_timestamp}')")
                        
                        if iso_timestamp == airtable_formatted:
                            matched_record = record
                            original_post_id = record_post_id
                            print(f"✅ Created At 매칭 성공! (생성 시간 기준)")
                            print(f"   evaluation 타임스탬프1: {timestamp}")
                            print(f"   input 타임스탬프2: {original_timestamp}")
                            print(f"   ISO 변환: {iso_timestamp}")
                            print(f"   Airtable Created At: {created_at}")
                            print(f"   변환된 시간: {airtable_formatted}")
                            print(f"   찾은 PostID: {original_post_id}")
                            break
                    except Exception as e:
                        if i < 3:
                            print(f"   ❌ Created At 파싱 실패: {str(e)}")
                        continue
            
            # 2차: Created At 실패시 Updated At으로 fallback
            if not matched_record:
                print(f"🔄 2차 시도: Created At 매칭 실패 → Updated At fallback...")
                
                matched_count = 0
                for i, record in enumerate(all_records):
                    updated_at = record['fields'].get('Updated At', '')
                    record_post_id = record['fields'].get('Post Id', '')
                    
                    if i < 3:
                        print(f"🔍 Fallback 레코드 {i+1}: PostID='{record_post_id}', Updated At='{updated_at}'")
                    
                    if updated_at and iso_timestamp:
                        try:
                            from datetime import datetime, timezone, timedelta
                            dt_utc = datetime.fromisoformat(updated_at.replace('Z', '+00:00'))
                            korea_tz = timezone(timedelta(hours=9))
                            dt_korea = dt_utc.astimezone(korea_tz)
                            airtable_formatted = dt_korea.strftime('%Y-%m-%d %H:%M')
                            
                            if i < 3:
                                print(f"   📅 Updated At 변환: '{updated_at}' → '{airtable_formatted}' (찾는값: '{iso_timestamp}')")
                            
                            if iso_timestamp == airtable_formatted:
                                matched_record = record
                                original_post_id = record_post_id
                                print(f"✅ Updated At 매칭 성공! (fallback)")
                                print(f"   찾은 PostID: {original_post_id}")
                                break
                            else:
                                matched_count += 1
                        except Exception as e:
                            if i < 3:
                                print(f"   ❌ Updated At 파싱 실패: {str(e)}")
                            continue
                
                print(f"🔢 Updated At으로 {matched_count}개 레코드를 확인했습니다.")
            
            if not matched_record:
                print(f"❌ Created At과 Updated At 모두에서 매칭 실패")
                print(f"   원본 타임스탬프2: {original_timestamp}")
                print(f"   변환된 ISO 형식: {iso_timestamp}")
                print("📋 전체 Medicontent Posts 레코드 목록 (Created At 기준):")
                for i, record in enumerate(all_records):  # 전체 레코드
                    post_id = record['fields'].get('Post Id', '')
                    created_at = record['fields'].get('Created At', '')
                    updated_at = record['fields'].get('Updated At', '')
                    try:
                        from datetime import datetime, timezone, timedelta
                        # Created At을 한국 시간대로 변환
                        if created_at:
                            dt_utc = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                            korea_tz = timezone(timedelta(hours=9))
                            dt_korea = dt_utc.astimezone(korea_tz)
                            created_formatted = dt_korea.strftime('%Y-%m-%d %H:%M')
                            match_status = "✅ 매칭!" if created_formatted == iso_timestamp else ""
                            print(f"   {i+1}. PostID: '{post_id}', Created At: '{created_at}' → '{created_formatted}' {match_status}")
                        else:
                            print(f"   {i+1}. PostID: '{post_id}', Created At: 없음")
                    except:
                        print(f"   {i+1}. PostID: '{post_id}', Created At: '{created_at}' (파싱실패)")
                return False
            
            record_id = matched_record['id']
            
            # HTML 파일에서 제목과 본문 추출
            title = ""
            content = ""
            if html_file:
                title, content = extract_title_and_content_from_html(str(html_file))
            else:
                print("⚠️ HTML 파일이 없어 제목과 본문을 추출할 수 없습니다.")
            
            # 현재 레코드에서 기존 SEO Score와 Legal Score 확인
            current_fields = matched_record['fields']
            existing_seo_score = current_fields.get('SEO Score')
            existing_legal_score = current_fields.get('Legal Score')
            
            # HTML ID 생성 (파일명에서 .html 확장자 제거)
            html_id = f"{timestamp}_content"
            
            # 업데이트할 데이터 준비
            update_data = {
                'Updated At': datetime.now().strftime('%Y-%m-%d %H:%M'),
                'HTML ID': html_id
            }
            
            # 제목과 본문 추가
            if title:
                update_data['Title'] = title
                print(f"📝 제목 추가: {title[:50]}...")
            
            if content:
                update_data['Content'] = content
                print(f"📝 HTML 본문 추가: {len(content)}자 (전체 HTML 파일)")
            
            # SEO Score 또는 Legal Score 추가
            if is_seo_score:
                update_data['SEO Score'] = weighted_total
                print(f"📈 SEO Score 설정: {weighted_total} (criteria: {criteria})")
            elif is_legal_score:
                update_data['Legal Score'] = weighted_total
                print(f"⚖️ Legal Score 설정: {weighted_total} (criteria: {criteria})")
            
            # 둘 다 있을 때만 작업 완료로 변경
            will_have_seo = existing_seo_score or is_seo_score
            will_have_legal = existing_legal_score or is_legal_score
            
            if will_have_seo and will_have_legal:
                update_data['Status'] = '작업 완료'
                print(f"✅ SEO Score와 Legal Score 모두 있음 → Status: 작업 완료")
            else:
                print(f"⏳ 아직 한쪽 Score만 있음 → Status 유지")
                print(f"   SEO Score: {'✅' if will_have_seo else '❌'}")
                print(f"   Legal Score: {'✅' if will_have_legal else '❌'}")
            
            # Airtable 업데이트 실행
            table.update(record_id, update_data)
            
            print(f"✅ Medicontent Posts 자동 업데이트 완료!")
            print(f"   타임스탬프: {timestamp}")
            print(f"   PostID: {original_post_id}")
            print(f"   Record ID: {record_id}")
            print(f"   Status: 작업 완료")
            print(f"   Title: {title[:50]}..." if title else "")
            print(f"   Content length: {len(content)}")
            print(f"   Score: {weighted_total} ({criteria})")
            
            return True
            
        except ImportError:
            print("⚠️ pyairtable 라이브러리가 없어 DB 업데이트를 건너뜁니다.")
            return False
        except Exception as e:
            print(f"❌ Airtable 업데이트 실패: {str(e)}")
            import traceback
            traceback.print_exc()
            return False
            
    except Exception as e:
        print(f"❌ 자동 DB 업데이트 실패: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

EVAL_PROMPT_PATH = PROMPTS_DIR / "llm_evaluation_prompt.txt"
REGEN_PROMPT_PATH = PROMPTS_DIR / "llm_regeneration_prompt.txt"
SEO_PROMPT_PATH = PROMPTS_DIR / "seo_evaluation_prompt.txt"
CRITERIA_PATH = DATA_DIR / "evaluation_criteria.json"
SEO_CRITERIA_PATH = DATA_DIR / "seo_evaluation_criteria.json"
DEFAULT_CSV_PATHS = [DATA_DIR / "medical_ad_checklist.csv", Path("/mnt/test_data/medical_ad_checklist.csv")]
DEFAULT_REPORT_PATHS = [DATA_DIR / "medical-ad-report.md", Path("/mnt/test_data/medical-ad-report.md")]

# ===== 체크리스트 명칭 =====
CHECKLIST_NAMES = {
    1: "허위·과장 표현", 2: "치료경험담", 3: "비급여 진료비 할인", 4: "사전심의 미이행",
    5: "치료 전후 사진", 6: "전문의 허위 표시", 7: "환자 유인·알선", 8: "비의료인 의료광고",
    9: "객관적 근거 부족", 10: "비교 광고", 11: "기사형 광고", 12: "부작용 정보 누락",
    13: "인증·보증 허위표시", 14: "가격 정보 오표시", 15: "연락처 정보 오류",
}

SEO_CHECKLIST_NAMES = {
    1: "제목 글자수 (공백 포함)", 2: "제목 글자수 (공백 제외)", 3: "본문 글자수 (공백 포함)",
    4: "본문 글자수 (공백 제외)", 5: "총 형태소 개수", 6: "총 음절 개수",
    7: "총 단어 개수", 8: "어뷰징 단어 개수", 9: "본문 이미지"
}

# ===== 리포트 가중치 (기본값) =====
DEFAULT_REPORT_WEIGHTS = {
    "1": 8.6, "2": 8.0, "3": 8.0, "4": 8.0, "5": 7.0,
    "6": 7.0, "7": 8.0, "8": 7.4, "9": 6.4, "10": 6.4,
    "11": 6.0, "12": 6.0, "13": 6.0, "14": 6.0, "15": 5.5
}

# ===== 규칙 엔진 기본 패턴(부족분은 CSV에서 보강) =====
BASE_PATTERNS = {
    1: [r"\b100\s*%\b", r"부작용\s*없(음|다)", r"\b최고\b", r"\b유일(한)?\b", r"완전\s*무통"],
    2: [r"후기|경험담|리뷰", r"만족도", r"치료\s*과정", r"치료\s*결과", r"협찬|제공\s*받"],
    3: [r"\d{1,3}\s?%(\s*할인)?", r"이벤트\s*가", r"행사\s*가", r"\b원\s*부터\b"],
    4: [r"심의번호", r"심의\s*미이행|미심의"],
    5: [r"\b전후\b", r"\bbefore\b", r"\bafter\b", r"!\[.*\]\(.*\)", r"<img[^>]+>"],
    6: [r"전문의", r"전문병원", r"임플란트\s*전문의", r"교정\s*전문병원"],
    7: [r"리뷰\s*이벤트", r"추첨", r"사은품", r"리뷰\s*작성\s*시", r"대가|포인트|기프티콘"],
    8: [r"인플루언서|일반인\s*광고", r"제휴\s*포스팅"],
    9: [r"임상결과|연구결과|데이터", r"근거\s*없(음|다)"],
    10:[r"타\s*병원|다른\s*병원", r"최초|최고|유일\s*비교", r"보다\s*낫"],
    11:[r"기사형|보도자료|인터뷰\s*형태", r"전문가\s*의견\s*형식"],
    12:[r"부작용|주의사항|개인차", r"리스크|합병증"],
    13:[r"인증|상장|감사장|추천", r"공식\s*인증"],
    14:[r"원\s*부터|최저가|할인\s*가", r"추가\s*비용|부가세"],
    15:[r"병원명|주소|전화|연락처", r"오류|불일치"],
}

# ===== SEO 메트릭 계산 (정제 유틸 추가) =====
# --- SEO 측정 전용: 이미지 감지+정제 ---
_IMG_EXT_RE = r'(?:jpg|jpeg|png|gif)'
_MKDOWN_IMG_RE = re.compile(r'!\[[^\]]*\]\(([^)]+)\)', re.IGNORECASE)   # ![alt](url)
_HTML_IMG_RE   = re.compile(r'<img\b[^>]*>', re.IGNORECASE)             # <img ...>
_PAREN_IMG_RE  = re.compile(r'\(([^()\s]+?\.' + _IMG_EXT_RE + r')\)', re.IGNORECASE)  # (file.ext)

def _extract_images_and_clean_text(raw: str) -> Tuple[str, int]:
    """
    - 이미지 개수: 마크다운/HTML/괄호형 파일명 3종을 합산 (중복 방지 위해 순차 제거)
    - 정제 텍스트: 이미지 표현(마크다운/HTML/괄호형 파일명) 모두 제거,
                  줄바꿈/탭→공백, 공백 다중 → 1칸으로 축약
    """
    if not isinstance(raw, str):
        return "", 0

    text = raw

    # 1) 마크다운 이미지: 카운트 & 제거
    md_hits = _MKDOWN_IMG_RE.findall(text)
    text = _MKDOWN_IMG_RE.sub(' ', text)

    # 2) HTML 이미지: 카운트 & 제거
    html_hits = _HTML_IMG_RE.findall(text)
    text = _HTML_IMG_RE.sub(' ', text)

    # 3) 괄호형 파일명: 카운트 & 제거  e.g., (ab.png)
    paren_hits = _PAREN_IMG_RE.findall(text)
    text = _PAREN_IMG_RE.sub(' ', text)

    # 4) 줄바꿈/탭 제거(→ 공백 1칸), 공백 다중 축약
    text = text.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ')
    text = re.sub(r'\s+', ' ', text).strip()

    image_count = len(md_hits) + len(html_hits) + len(paren_hits)
    return text, image_count

def _calculate_morphemes(text: str) -> int:
    """형태소 개수 계산 (kiwipiepy 사용)"""
    from kiwipiepy import Kiwi
    kiwi = Kiwi()
    result = kiwi.analyze(text)
    tokens, score = result[0]
    morphemes = [token.form for token in tokens]
    return len(morphemes)

def _count_syllables_extended(text: str) -> int:
    """음절 개수 계산 (한글 + 영문)"""
    import unicodedata
    text = unicodedata.normalize('NFC', text)
    syllables = 0
    for ch in text:
        if 0xAC00 <= ord(ch) <= 0xD7A3:  # 한글 완성형
            syllables += 1
        elif ch.isascii() and ch.isalpha():  # 영문만
            syllables += 1
    return syllables

def calculate_seo_metrics(title: str, content: str) -> Dict[str, int]:
    """SEO 평가용 실제 측정값 (렌더 결과 기준: 이미지/alt/파일명 제거, 줄바꿈 제외)"""
    import re

    # --- 제목(그대로) ---
    title_with_space = len(title)
    title_without_space = len(title.replace(" ", ""))
    print(f"DEBUG - 제목: '{title}'")
    print(f"DEBUG - 공백 포함: {title_with_space}, 공백 제외: {title_without_space}")

    # --- 본문: 정제 + 이미지 카운트 ---
    cleaned, image_count = _extract_images_and_clean_text(content)

    # 3/4. 본문 글자수
    content_with_space = len(cleaned)
    content_without_space = len(re.sub(r'\s+', '', cleaned))  # 모든 공백 제거(개행 포함)

    # 5. 형태소(정제 텍스트 기준)
    morpheme_count = _calculate_morphemes(cleaned)

    # 6. 음절(정제 텍스트 기준)
    syllable_count = _count_syllables_extended(cleaned)

    # 7. 단어(정제 텍스트 기준)
    word_count = len(re.findall(r'[\w가-힣]+', cleaned))

    # 8. 어뷰징 단어(정제 텍스트 기준)
    abusing_patterns = [
        r'19금', r'성인', r'유해', r'도박', r'불법', r'사기',
        r'100%', r'완전무료', r'대박', r'짱', r'헐', r'1등', r'최고', r'최강', r'완벽', r'보장', r'완치', r'치료보장',
        r'즉시', r'당일', r'바로', r'지금\s*당장', r'반드시', r'절대', r'무조건',
        r'전부', r'전세계', r'국내유일', r'독점', r'유일무이', r'베스트', r'프리미엄',
        r'명품', r'초특가', r'파격', r'무료', r'공짜', r'할인', r'이벤트', r'사은품',
        r'한정', r'마감임박', r'재고소진', r'선착순', r'단독', r'최초', r'유일',
        r'완전', r'필수', r'강력추천'
    ]
    abusing_count = sum(len(re.findall(pat, cleaned, re.IGNORECASE)) for pat in abusing_patterns)

    return {
        1: title_with_space,
        2: title_without_space,
        3: content_with_space,
        4: content_without_space,
        5: morpheme_count,
        6: syllable_count,
        7: word_count,
        8: abusing_count,
        9: image_count
    }

# ===== 유틸 =====
def _nowstamp() -> str:
    return datetime.now().strftime("%Y%m%d_%H%M%S")

def _read_text(p: Path) -> str:
    if not p.exists():
        raise FileNotFoundError(f"파일 없음: {p}")
    return p.read_text(encoding="utf-8")

def _read_json(p: Path) -> Any:
    if not p.exists():
        raise FileNotFoundError(f"파일 없음: {p}")
    return json.loads(p.read_text(encoding="utf-8"))

def _write_json(p: Path, obj: Any):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")

def _latest(log_dir: Path, glob_pat: Union[str, List[str]]) -> Path:
    # log_dir 안의 최신 날짜 폴더 선택
    date_dirs = [p for p in log_dir.iterdir() if p.is_dir()]
    if not date_dirs:
        raise FileNotFoundError(f"날짜 폴더를 찾을 수 없습니다: {log_dir}")

    latest_date_dir = max(date_dirs, key=lambda d: d.stat().st_mtime)

    # 그 안에서 glob 탐색
    patterns = glob_pat if isinstance(glob_pat, list) else [glob_pat]
    candidates: List[Path] = []
    for pat in patterns:
        candidates.extend(list(latest_date_dir.glob(pat)))

    if not candidates:
        listing = "\n".join(sorted([p.name for p in latest_date_dir.glob('*')]))
        raise FileNotFoundError(
            f"최신 파일을 찾을 수 없습니다: {latest_date_dir}/{patterns}\n"
            f"현재 파일 목록:\n{listing if listing else '(비어 있음)'}"
        )

    candidates.sort(key=lambda x: x.stat().st_mtime, reverse=True)
    return candidates[0]

# ===== LLM =====
def _setup_llm():
    load_dotenv()
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY가 .env에 없습니다.")
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-pro")

def _extract_json(raw: str) -> Dict[str, Any]:
    if not raw:
        raise ValueError("LLM 응답이 비어 있습니다.")
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        text = text[start:end+1]
    text = text.strip().strip("`").strip()
    return json.loads(text)

def _call_llm(model, prompt: str) -> Dict[str, Any]:
    resp = model.generate_content(prompt)
    text = getattr(resp, "text", "") or ""
    if not text:
        try:
            cand0 = resp.candidates[0]
            parts = getattr(getattr(cand0, "content", None), "parts", []) or []
            text = "".join(getattr(p, "text", "") for p in parts if getattr(p, "text", ""))
        except Exception:
            pass
    if not text:
        raise RuntimeError("LLM 응답 파싱 실패(빈 응답). 프롬프트 또는 안전필터 확인.")
    return _extract_json(text)

# ===== 재귀 탐색 도구 =====
def _iter_paths(obj: Any, prefix: Tuple=()) -> Iterable[Tuple[Tuple, Any]]:
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _iter_paths(v, prefix + (k,))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _iter_paths(v, prefix + (i,))
    else:
        yield (prefix, obj)

def _path_to_str(path: Tuple) -> str:
    return ".".join(str(p) for p in path)

TITLE_KEY_HINTS = ["title","post_title","page_title","doc_title","headline","h1"]
CONTENT_KEY_HINTS = ["content","body","post_content","article","markdown","md","html","text",
                     "paragraph","paragraphs","section","sections","blocks","document","value"]

def _score_title_candidate(s: str) -> float:
    if not isinstance(s, str): return -1
    l = len(s.strip())
    if l < 3: return -1
    score = 0.0
    if 10 <= l <= 120: score += 2.0
    elif l <= 200: score += 1.0
    if sum(ch in "#*{}[]" for ch in s) > 5: score -= 0.5
    return score + min(l/200.0, 1.0)

def _normalize_block_to_text(val: Any) -> str:
    if isinstance(val, str):
        return val
    if isinstance(val, list):
        parts = []
        for it in val:
            if isinstance(it, str):
                parts.append(it)
            elif isinstance(it, dict):
                for k in ["text","content","paragraph","markdown","md","html","value"]:
                    v = it.get(k)
                    if isinstance(v, str) and v.strip():
                        parts.append(v)
                        break
        return "\n\n".join(p for p in parts if p.strip())
    if isinstance(val, dict):
        for k in ["markdown","md","html","text","content","body","value"]:
            v = val.get(k)
            if isinstance(v, str) and v.strip():
                return v
        for k in ["paragraphs","sections","blocks"]:
            v = val.get(k)
            if isinstance(v, list) and v:
                s = _normalize_block_to_text(v)
                if s.strip(): return s
    return ""

def _extract_title_content(clog: Dict[str, Any]) -> Tuple[str, str, Dict[str, Any]]:
    cand_titles: List[Tuple[str, str, float]] = []
    cand_contents: List[Tuple[str, str, int]] = []
    for path, val in _iter_paths(clog):
        pstr = _path_to_str(path)
        key_lower = str(path[-1]).lower() if path else ""

        # 디버그 출력 추가
        if "title" in key_lower:
            print(f"DEBUG - 발견된 title 관련 키: path={pstr}, key_lower='{key_lower}', val='{val}', 매치={any(key_lower == h for h in TITLE_KEY_HINTS)}")
    
        if any(key_lower == h for h in TITLE_KEY_HINTS) and isinstance(val, str):
            s = val.strip()
            if s: 
                score = _score_title_candidate(s)
                print(f"DEBUG - title 후보 추가: '{s}', score={score}")
                cand_titles.append((pstr, s, score))
                
        if any(h in key_lower for h in CONTENT_KEY_HINTS):
            text = _normalize_block_to_text(val)
            if not text and isinstance(val, str):
                text = val
            if isinstance(text, str) and text.strip():
                cand_contents.append((pstr, text, len(text)))
    title, title_path = "", ""
    if cand_titles:
        cand_titles.sort(key=lambda x: x[2], reverse=True)
        title_path, title, _ = cand_titles[0]
    else:
        # 먼저 최상위 레벨의 title 키를 직접 확인 (우선순위)
        for k in ["title", "Title", "post_title"]:
            if k in clog and isinstance(clog[k], str) and clog[k].strip():
                title = clog[k].strip()
                title_path = k
                break
        
        # 직접 키 접근이 실패한 경우에만 selected.title 확인
        if not title:
            if isinstance(clog.get("selected"), dict) and isinstance(clog["selected"].get("title"), str):
                title = clog["selected"]["title"].strip()
                title_path = "selected.title"
    content, content_path = "", ""
    if cand_contents:
        cand_contents.sort(key=lambda x: (x[2] >= 300, x[2]), reverse=True)
        content_path, content, _ = cand_contents[0]
    else:
        if isinstance(clog.get("content"), list):
            content = "\n\n".join(map(str, clog["content"])); content_path = "content(list)"
        if not content:
            for parent in ["result","data"]:
                if isinstance(clog.get(parent), dict):
                    v = clog[parent].get("content") or clog[parent].get("body") or clog[parent].get("post_content")
                    s = _normalize_block_to_text(v)
                    if s.strip():
                        content = s.strip(); content_path = f"{parent}.content/body/post_content"; break
    dbg = {
        "title_path": title_path,
        "content_path": content_path,
        "title_candidates": [{"path":p,"len":len(v),"score":sc} for (p,v,sc) in cand_titles[:5]],
        "content_candidates": [{"path":p,"len":l} for (p,_,l) in cand_contents[:5]],
    }
    return title.strip(), content.strip(), dbg

# ===== CSV 로드/규칙 컴파일 =====
def _find_existing(paths: List[Path]) -> Path:
    for p in paths:
        if p.exists(): return p
    raise FileNotFoundError(f"경로들 중 파일이 없습니다: {paths}")

def load_checklist_csv(path: Path) -> List[Dict[str, str]]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            # 헤더 예: 번호,항목명,항목설명,평가방법,위반위험도
            rows.append({k.strip(): (v.strip() if isinstance(v,str) else v) for k,v in r.items()})
    return rows

def compile_patterns(rows: List[Dict[str,str]]) -> Dict[int, List[re.Pattern]]:
    patterns: Dict[int, List[re.Pattern]] = {}
    for r in rows:
        try:
            idx = int(r.get("번호") or r.get("no") or r.get("index"))
        except Exception:
            continue
        p_list = BASE_PATTERNS.get(idx, []).copy()
        eval_method = (r.get("평가방법") or "").replace("<br>", "\n")
        # 키워드 후보 추출(간단)
        for kw in ["최고","유일","완전","100%","부작용 없음","이벤트","할인","전후","before","after",
                   "리뷰","후기","협찬","가격","원부터","심의번호","전문의","전문병원","주의사항","부작용","개인차",
                   "인증","상장","감사장","추천","기사형","보도자료","인터뷰","타 병원","최초","유일"]:
            if kw in eval_method and kw not in p_list:
                p_list.append(re.escape(kw))
        try:
            patterns[idx] = [re.compile(p, flags=re.I) for p in p_list]
        except re.error:
            # 잘못된 패턴은 스킵
            patterns[idx] = [re.compile(re.escape(p), flags=re.I) for p in p_list if p]
    return patterns

def rule_score_item(idx: int, text: str, pats: Dict[int, List[re.Pattern]]) -> Tuple[int, List[str]]:
    if idx not in pats or not pats[idx]:
        return 0, []
    hits = []
    for rgx in pats[idx]:
        m = rgx.search(text)
        if m: hits.append(m.group(0))
    if not hits: return 0, []
    # 휴리스틱 스코어링
    strong = any(re.search(r"100\s*%|부작용\s*없", h, re.I) for h in hits)
    if idx == 1 and strong: return 5, hits
    if idx in [3,5,7,14] and len(hits) >= 2: return 5, hits
    # 기본: 1개 발견=2, 2개 이상=3 (필요시 세분화)
    return (2 if len(hits) == 1 else 3), hits

def rule_score_all(title: str, content: str, pats: Dict[int, List[re.Pattern]]) -> Dict[str, Dict[str, Any]]:
    text = f"{title}\n\n{content}"
    results: Dict[str, Dict[str, Any]] = {}
    for i in range(1, 16):
        s, hits = rule_score_item(i, text, pats)
        results[str(i)] = {"score": s, "hits": hits}
    return results

# ===== 가중 총점 =====
def parse_report_weights(md_path: Path) -> Dict[str, float]:
    # 간단 파서: 3.1 테이블 라인에서 숫자 추출 (없으면 DEFAULT 사용)
    try:
        md = _read_text(md_path)
        lines = md.splitlines()
        weights = {}
        in_table = False
        for ln in lines:
            if "| 순위 |" in ln and "우선순위 점수" in ln:
                in_table = True
                continue
            if in_table:
                if ln.strip().startswith("|------"):
                    continue
                if not ln.strip().startswith("|"):
                    break
                # | 1 | 허위·과장 표현 | 8.6 | ...
                cells = [c.strip() for c in ln.strip().strip("|").split("|")]
                if len(cells) >= 3:
                    name = cells[1]; w_str = cells[2]
                    # name → index 역매핑
                    idx = None
                    for k,v in CHECKLIST_NAMES.items():
                        if v in name:
                            idx = k; break
                    if idx:
                        try:
                            weights[str(idx)] = float(w_str)
                        except:
                            pass
        return weights if weights else DEFAULT_REPORT_WEIGHTS
    except Exception:
        return DEFAULT_REPORT_WEIGHTS

def weighted_total(final_scores: Dict[str,int], weights: Dict[str,float], evaluation_mode: str = "medical") -> float:
    if evaluation_mode == "seo":
        # SEO 모드: 실제 점수의 합계를 그대로 사용
        return round(sum(final_scores.get(str(i), 0) for i in range(1, 10)), 1)
    else:
        # 의료법 모드: 기존 방식 (5점 만점 기준)
        num = sum((final_scores.get(k,0)/5.0) * weights[k] for k in weights)
        den = sum(weights.values())
        return round((num/den)*100, 1) if den else 0.0

# ===== 임계 비교 =====
def over_threshold(scores: Dict[str, int], criteria: Dict[str, Dict[str, int]], mode: str, evaluation_mode: str = "medical") -> List[int]:
    th = criteria.get(mode)
    if not th:
        raise ValueError(f"criteria 모드가 올바르지 않습니다: {mode}")
    violations = []
    for k, v in scores.items():
        key = str(k)
        try:
            idx = int(key)
        except ValueError:
            continue
        limit = th.get(key, 5)
        # SEO와 의료법 평가 기준 다르게 적용
        if evaluation_mode == "seo":
            if v < limit:  # SEO: 점수가 낮으면 위반
                violations.append(idx)
        else:
            if v > limit:  # 의료법: 점수가 높으면 위반
                violations.append(idx)
    return violations

def map_stage(violations: List[int]) -> str:
    if any(v in [1,2,3,5,7,9,12,14] for v in violations):
        return "content"
    if any(v in [6,10,11] for v in violations):
        return "both"
    if any(v in [4,8,15] for v in violations):
        return "content"
    return "content"

# ===== 패치 적용 =====
def apply_patches(title: str, content: str, patch_obj: Dict[str, Any]) -> Tuple[str, str]:
    new_title, new_content = title, content
    for u in patch_obj.get("patch_units", []):
        typ = u.get("type")
        scope = u.get("scope")
        before = u.get("before", "")
        after = u.get("after", "")
        if scope == "title":
            if typ == "replace":
                new_title = new_title.replace(before, after) if before else after
            elif typ == "insert":
                new_title = after
            elif typ == "delete" and before:
                new_title = new_title.replace(before, "")
        else:
            if typ == "replace" and before and before in new_content:
                new_content = new_content.replace(before, after)
            elif typ == "insert" and after:
                new_content += "\n\n" + after
            elif typ == "delete" and before:
                new_content = new_content.replace(before, "")
    return new_title, new_content

# ===== 프롬프트 빌드 =====
def build_eval_prompt(title: str, content: str, prompt_path: Path = EVAL_PROMPT_PATH, seo_metrics: Dict[int, int] = None) -> str:
    base = _read_text(prompt_path)

    # SEO 모드에서 실제 측정값과 정답을 프롬프트에 포함
    if seo_metrics and "seo_evaluation_prompt" in str(prompt_path):
        # 각 항목별 정확한 점수 계산
        def get_correct_score(item_num, value):
            if item_num == 1:  # 제목 글자수 (공백 포함)
                if 26 <= value <= 48: return 12
                elif 49 <= value <= 69: return 9
                elif 15 <= value <= 25: return 6
                else: return 3
            elif item_num == 2:  # 제목 글자수 (공백 제외)
                if 15 <= value <= 30: return 12
                elif 31 <= value <= 56: return 9
                elif 10 <= value <= 14: return 6
                else: return 3
            elif item_num == 3:  # 본문 글자수 (공백 포함)
                if 1233 <= value <= 2628: return 15
                elif 2629 <= value <= 4113: return 12
                elif 612 <= value <= 1232: return 9
                else: return 5
            elif item_num == 4:  # 본문 글자수 (공백 제외)
                if 936 <= value <= 1997: return 15
                elif 1998 <= value <= 3400: return 12
                elif 512 <= value <= 935: return 9
                else: return 5
            elif item_num == 5:  # 총 형태소 개수
                if 249 <= value <= 482: return 10
                elif 483 <= value <= 672: return 8
                elif 183 <= value <= 248: return 6
                else: return 3
            elif item_num == 6:  # 총 음절 개수
                if 298 <= value <= 632: return 10
                elif 633 <= value <= 892: return 8
                elif 184 <= value <= 297: return 6
                else: return 3
            elif item_num == 7:  # 총 단어 개수
                if 82 <= value <= 193: return 10
                elif 194 <= value <= 284: return 8
                elif 54 <= value <= 81: return 6
                else: return 3
            elif item_num == 8:  # 어뷰징 단어 개수
                if 0 <= value <= 7: return 8
                elif 8 <= value <= 14: return 6
                elif 15 <= value <= 21: return 4
                else: return 2
            elif item_num == 9:  # 본문 이미지
                if 3 <= value <= 11: return 8
                elif 4 <= value <= 11: return 6
                elif 4 <= value <= 11: return 4
                else: return 2
            return 0

        metrics_text = f"""

실제 측정값과 정답:
1. 제목 글자수 (공백 포함): {seo_metrics.get(1, 0)}글자 → {get_correct_score(1, seo_metrics.get(1, 0))}점
2. 제목 글자수 (공백 제외): {seo_metrics.get(2, 0)}글자 → {get_correct_score(2, seo_metrics.get(2, 0))}점  
3. 본문 글자수 (공백 포함): {seo_metrics.get(3, 0)}글자 → {get_correct_score(3, seo_metrics.get(3, 0))}점
4. 본문 글자수 (공백 제외): {seo_metrics.get(4, 0)}글자 → {get_correct_score(4, seo_metrics.get(4, 0))}점
5. 총 형태소 개수: {seo_metrics.get(5, 0)}개 → {get_correct_score(5, seo_metrics.get(5, 0))}점
6. 총 음절 개수: {seo_metrics.get(6, 0)}개 → {get_correct_score(6, seo_metrics.get(6, 0))}점
7. 총 단어 개수: {seo_metrics.get(7, 0)}개 → {get_correct_score(7, seo_metrics.get(7, 0))}점
8. 어뷰징 단어 개수: {seo_metrics.get(8, 0)}개 → {get_correct_score(8, seo_metrics.get(8, 0))}점
9. 본문 이미지: {seo_metrics.get(9, 0)}개 → {get_correct_score(9, seo_metrics.get(9, 0))}점

위의 정답 점수를 그대로 사용하세요! 다른 점수를 부여하지 마세요!"""
        base = base + metrics_text

    enforce = "\n\n반드시 위의 출력 형식의 JSON만 출력하고, 추가 설명은 쓰지 마십시오."
    return base.replace("[여기에 제목 입력]", title).replace("[여기에 본문 입력]", content) + enforce

def build_regen_prompt(title: str, content: str, criteria_mode: str,
                       violations: List[int], hints: List[str]) -> str:
    base = _read_text(REGEN_PROMPT_PATH)
    vnames = [f"{CHECKLIST_NAMES[i]}({i})" for i in violations]
    violations_json = json.dumps(vnames, ensure_ascii=False)
    hints_json = json.dumps(hints or [], ensure_ascii=False)
    prompt = (base
              .replace("{title}", title)
              .replace("{content}", content)
              .replace("{criteria}", criteria_mode)
              .replace("{violations}", violations_json)
              .replace("{hints}", hints_json))
    return prompt

# ===== 재생성 적합도(0~100) =====
RISK_KEYWORDS = {
    "부작용": [r"부작용", r"주의사항", r"개인차", r"합병증"],
    "가격고지": [r"가격", r"비용", r"추가\s*비용", r"부가세"],
    "근거제시": [r"연구|임상|데이터|근거|가이드라인"],
    "유인삭제": [r"리뷰\s*이벤트|추첨|사은품|기프티콘|대가"],
    "과장완화": [r"100\s*%|최고|유일|완전\s*무통|부작용\s*없"],
}

def _presence_rate(text: str, patterns: List[str]) -> float:
    if not patterns: return 0.0
    hits = sum(1 for p in patterns if re.search(p, text, re.I))
    return hits / len(patterns)

def regen_fit_score(before_over: List[int], after_over: List[int],
                    before_text: str, after_text: str,
                    tips: List[str]) -> Dict[str, Any]:
    # 1) 위반해소율
    b = len(before_over); a = len(after_over)
    risk_reduction = (b - a) / b if b else 1.0

    # 2) 권고 반영율
    adherence_checks = []
    for t in tips:
        t = str(t)
        key = None
        if any(k in t for k in ["부작용","주의","개인차"]): key = "부작용"
        elif any(k in t for k in ["가격","비용","부가세"]): key = "가격고지"
        elif any(k in t for k in ["연구","임상","데이터","근거"]): key = "근거제시"
        elif any(k in t for k in ["리뷰","이벤트","추첨","사은품","대가","기프티콘"]): key = "유인삭제"
        elif any(k in t for k in ["100%","최고","유일","완전","무통","과장","절대"]): key = "과장완화"

        if key:
            pats = RISK_KEYWORDS[key]
            if key in ["부작용","가격고지","근거제시"]:
                adherence_checks.append(_presence_rate(after_text, pats))
            else:
                before_r = _presence_rate(before_text, pats)
                after_r  = _presence_rate(after_text, pats)
                adherence_checks.append(1.0 if after_r < before_r else 0.0)

    guideline_adherence = sum(adherence_checks)/len(adherence_checks) if adherence_checks else 0.0

    # 3) 흐름 안정성
    def stats(s: str):
        paras = [p for p in s.split("\n\n") if p.strip()]
        sents = re.split(r"[.!?]\s+|[.\n]\s+", s)
        chars = len(s)
        return {
            "paras": len(paras) or 1,
            "sents": len([x for x in sents if x.strip()]) or 1,
            "chars": chars or 1
        }
    sb = stats(before_text); sa = stats(after_text)

    def stable_ratio(a,b): return max(0.0, 1.0 - abs(a-b)/max(a,1))
    flow = 0.5*stable_ratio(sa["paras"], sb["paras"]) + 0.3*stable_ratio(sa["sents"], sb["sents"]) + 0.2*stable_ratio(sa["chars"], sb["chars"])
    flow = max(0.0, min(flow, 1.0))

    final = round((0.5*risk_reduction + 0.3*guideline_adherence + 0.2*flow)*100)
    return {
        "risk_reduction_rate": round(risk_reduction, 3),
        "guideline_adherence": round(guideline_adherence, 3),
        "flow_stability": round(flow, 3),
        "score_0_100": final
    }

# ===== 메인 루프 =====
def run(criteria_mode: str = "표준",
        max_loops: int = 2,
        auto_yes: bool = False,
        log_dir: Union[str, None] = None,
        pattern: Union[str, None] = None,
        debug: bool = False,
        csv_path: Union[str, None] = None,
        report_path: Union[str, None] = None,
        evaluation_mode: str = "medical"):

    # 로그 디렉토리
    log_dir_path = Path(log_dir) if log_dir else DEFAULT_LOG_DIR
    log_dir_path.mkdir(parents=True, exist_ok=True)

    # 탐색 패턴을 TXT 파일로 변경
    patterns = [p.strip() for p in (pattern.split(",") if pattern else []) if p.strip()]
    search_patterns = patterns or [
        "*_title_content_result.txt",
        "*title_content*.txt", 
        "*content*.txt",
        "*_content_result.txt"
    ]

    # 0) TXT 파일 로드
    content_path = _latest(log_dir_path, search_patterns)
    
    # TXT 파일 읽기
    txt_content = _read_text(content_path)
    
    # 첫 줄을 제목으로, 나머지를 본문으로 분리
    lines = txt_content.split('\n')
    if lines:
        title = lines[0].strip()
        content = '\n'.join(lines[2:]).strip() if len(lines) > 2 else ""  # 첫 줄 제목, 둘째 줄 공백, 셋째 줄부터 본문
    else:
        title = ""
        content = ""
    
    print(f"DEBUG - TXT에서 추출된 제목: '{title}'")
    print(f"DEBUG - TXT에서 추출된 본문 길이: {len(content)}")
    
    if not title:
        raise ValueError(f"{content_path.name}에서 제목을 찾을 수 없습니다.")

    # 콘텐츠가 없으면 더미 콘텐츠 사용
    if not content:
        content = "제목 평가용 더미 콘텐츠입니다."

    # SEO 모드에서 실제 측정값 계산 (정제 적용)
    seo_metrics = {}
    if evaluation_mode == "seo":
        seo_metrics = calculate_seo_metrics(title, content)

    # 1) 기준/CSV/리포트 가중치 로드
    if evaluation_mode == "seo":
        criteria = _read_json(SEO_CRITERIA_PATH)
        eval_prompt_path = SEO_PROMPT_PATH
    else:
        criteria = _read_json(CRITERIA_PATH)
        eval_prompt_path = EVAL_PROMPT_PATH
    if evaluation_mode == "medical":
        csv_file = Path(csv_path) if csv_path else _find_existing(DEFAULT_CSV_PATHS)
        rows = load_checklist_csv(csv_file)
        pats = compile_patterns(rows)
        report_file = Path(report_path) if report_path else _find_existing(DEFAULT_REPORT_PATHS)
        weights = parse_report_weights(report_file)
        # 2) 규칙 기반 사전 스코어
        rule_all = rule_score_all(title, content, pats)
    else:
        # SEO 모드에서는 규칙 기반 평가 건너뛰기
        rule_all = {}
        weights = {str(i): 1.0 for i in range(1, 10)}  # SEO는 9개 항목

    # 3) LLM 평가
    model = _setup_llm()
    if evaluation_mode == "seo":
        eval_prompt = build_eval_prompt(title, content, eval_prompt_path, seo_metrics)
    else:
        eval_prompt = build_eval_prompt(title, content, eval_prompt_path)
    result = _call_llm(model, eval_prompt)
    llm_scores: Dict[str, int] = result.get("평가결과", {}) or {}
    analysis: str = result.get("상세분석", "") or ""
    tips: List[str] = result.get("권고수정", []) or []

    def fuse(rule_all: Dict[str, Dict[str,Any]], llm_scores: Dict[str,int]) -> Dict[str,int]:
        fused = {}
        max_items = 9 if evaluation_mode == "seo" else 15
        for i in range(1,max_items + 1):
            r = int(rule_all.get(str(i),{}).get("score",0))
            l = int(llm_scores.get(str(i),0))
            fused[str(i)] = max(r,l)
        return fused

    final_scores = fuse(rule_all, llm_scores)

    # 4) 판정/가중 총점
    violations_before = over_threshold(final_scores, criteria, criteria_mode, evaluation_mode)
    print(f"DEBUG - final_scores: {final_scores}")
    print(f"DEBUG - criteria[{criteria_mode}]: {criteria.get(criteria_mode)}")
    weighted_total_before = weighted_total(final_scores, weights, evaluation_mode)

    history: List[Dict[str, Any]] = []
    loop = 0
    patched_once = False
    title_before, content_before = title, content

    while True:
        loop += 1
        history.append({
            "loop": loop,
            "rule_scores": {k:v["score"] for k,v in rule_all.items()},
            "llm_scores": llm_scores,
            "final_scores": final_scores,
            "violations": violations_before,
            "analysis": analysis,
            "tips": tips
        })

        if not violations_before or loop >= max_loops:
            # 최종 산출 JSON
            out = {
                "input": {
                    "source_log": content_path.name,
                    "title": title,
                    "content": content,
                    "content_len": len(content)
                },
                "modes": {"criteria": criteria_mode},
                "scores": {
                    "by_item": {
                        str(i): {
                            "name": (SEO_CHECKLIST_NAMES[i] if evaluation_mode == "seo" else CHECKLIST_NAMES[i]),
                            "rule_score": int(rule_all.get(str(i),{}).get("score",0)),
                            "llm_score": int(llm_scores.get(str(i),0)),
                            "final_score": int(final_scores.get(str(i),0)),
                            "threshold": criteria[criteria_mode].get(str(i),5),
                            "passed": int(final_scores.get(str(i),0)) <= criteria[criteria_mode].get(str(i),5),
                            "evidence": {
                                "regex_hits": rule_all.get(str(i),{}).get("hits",[]),
                            },
                            **({"actual_value": seo_metrics.get(i, 0)} if evaluation_mode == "seo" else {})
                        } for i in range(1, 10 if evaluation_mode == "seo" else 16)
                    },
                    "weighted_total": weighted_total_before,
                    "llm_total_raw": sum(int(llm_scores.get(str(i),0)) for i in range(1, 10 if evaluation_mode == "seo" else 16)),
                    "rule_total_proxy": sum(int(rule_all.get(str(i),{}).get("score",0)) for i in range(1, 10 if evaluation_mode == "seo" else 16))
                },
                "violations": {
                    "over_threshold": violations_before,
                    "names": [(SEO_CHECKLIST_NAMES[i] if evaluation_mode == "seo" else CHECKLIST_NAMES[i]) for i in violations_before]
                },
                "regen_fit": {
                    "applied": patched_once
                },
                "notes": {
                    "recommendations": tips,
                    "report_weights": weights
                },
                "title": title,
                "content": content
            }

            # 재생성이 있었으면 적합도 계산
            if patched_once:
                b_over = history[0]["violations"]
                a_over = violations_before
                before_text = f"{title_before}\n\n{content_before}"
                after_text  = f"{title}\n\n{content}"
                rf = regen_fit_score(b_over, a_over, before_text, after_text, tips)
                out["regen_fit"].update({
                    "before_over_threshold": len(b_over),
                    "after_over_threshold": len(a_over),
                    **rf
                })

            out_path = log_dir_path / f"{_nowstamp()}_evaluation.json"
            _write_json(out_path, out)
            
            # ⭐ UI checklist 로그 생성
            generate_ui_checklist_logs(out, str(out_path))
            
            # ⭐ 자동 DB 업데이트
            auto_update_medicontent_posts(out, str(out_path))

            if patched_once:
                patched_path = log_dir_path / f"{_nowstamp()}_content.patched.json"
                _write_json(patched_path, {"title": title, "content": content})

            print(("✅ 기준 충족. " if not violations_before else "⚠️ 반복 상한 도달. ") +
                  f"결과 저장: {out_path.name}")
            return

        # 필요 시 재생성
        if not auto_yes:
            yn = input(f"기준 초과 항목 {violations_before}가 있습니다. 국소 수정 진행할까요? (Y/n): ").strip().lower()
            if yn and yn.startswith("n"):
                # 재생성 거부 시에도 평가 결과 저장
                out = {
                    "input": {
                        "source_log": content_path.name,
                        "title": title,
                        "content": content,
                        "content_len": len(content)
                    },
                    "modes": {"criteria": criteria_mode},
                    "scores": {
                        "by_item": {
                            str(i): {
                                "name": (SEO_CHECKLIST_NAMES[i] if evaluation_mode == "seo" else CHECKLIST_NAMES[i]),
                                "rule_score": int(rule_all.get(str(i),{}).get("score",0)),
                                "llm_score": int(llm_scores.get(str(i),0)),
                                "final_score": int(final_scores.get(str(i),0)),
                                "threshold": criteria[criteria_mode].get(str(i),5),
                                "passed": int(final_scores.get(str(i),0)) <= criteria[criteria_mode].get(str(i),5),
                                "evidence": {
                                    "regex_hits": rule_all.get(str(i),{}).get("hits",[]),
                                },
                                **({"actual_value": seo_metrics.get(i, 0)} if evaluation_mode == "seo" else {})
                            } for i in range(1, 9 if evaluation_mode == "seo" else 16)
                        },
                        "weighted_total": weighted_total_before,
                        "llm_total_raw": sum(int(llm_scores.get(str(i),0)) for i in range(1, 9 if evaluation_mode == "seo" else 16)),
                        "rule_total_proxy": sum(int(rule_all.get(str(i),{}).get("score",0)) for i in range(1, 9 if evaluation_mode == "seo" else 16))
                    },
                    "violations": {
                        "over_threshold": violations_before,
                        "names": [(SEO_CHECKLIST_NAMES[i] if evaluation_mode == "seo" else CHECKLIST_NAMES[i]) for i in violations_before]
                    },
                    "regen_fit": {
                        "applied": False,  # 재생성 거부했으므로 False
                        "user_declined": True  # 사용자가 거부했다는 표시
                    },
                    "notes": {
                        "recommendations": tips,
                        "report_weights": weights
                    },
                    "title": title,
                    "content": content
                }
        
                out_path = log_dir_path / f"{_nowstamp()}_evaluation.json"
                _write_json(out_path, out)
                print(f"⚠️ 재생성 거부. 원본 평가 결과 저장: {out_path.name}")
                
                # ⭐ UI checklist 로그 생성
                generate_ui_checklist_logs(out, str(out_path))
                
                # ⭐ 자동 DB 업데이트
                auto_update_medicontent_posts(out, str(out_path))
                
                return
                

        # 재생성 → 패치
        stage = map_stage(violations_before)
        regen_prompt = build_regen_prompt(title, content, criteria_mode, violations_before, tips)
        patch_obj = _call_llm(model, regen_prompt)
        title, content = apply_patches(title, content, patch_obj)
        patched_once = True

        # 재평가 사이클: 규칙 + LLM 다시
        if evaluation_mode == "medical":
            rule_all = rule_score_all(title, content, pats)
        else:
            rule_all = {}
        if evaluation_mode == "seo":
            eval_prompt = build_eval_prompt(title, content, eval_prompt_path, seo_metrics)
        else:
            eval_prompt = build_eval_prompt(title, content, eval_prompt_path)
        result = _call_llm(model, eval_prompt)
        llm_scores = result.get("평가결과", {}) or {}
        analysis = result.get("상세분석", "") or ""
        tips = result.get("권고수정", []) or []
        max_items = 9 if evaluation_mode == "seo" else 15
        final_scores = {str(i): max(int(rule_all.get(str(i),{}).get("score",0)),
                                    int(llm_scores.get(str(i),0))) for i in range(1,max_items + 1)}
        violations_before = over_threshold(final_scores, criteria, criteria_mode)
        weighted_total_before = weighted_total(final_scores, weights, evaluation_mode)
        # 다음 루프

# ===== CLI =====
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--criteria", default="표준", help="엄격 | 표준 | 유연")
    parser.add_argument("--max_loops", type=int, default=2)
    parser.add_argument("--auto-yes", action="store_true")
    parser.add_argument("--log-dir", default=str(DEFAULT_LOG_DIR), help="로그 디렉토리(기본: test_logs/test)")
    parser.add_argument("--pattern", default="", help="탐색 패턴(쉼표로 여러 개). 비우면 기본 패턴 리스트 사용")
    parser.add_argument("--csv-path", default="", help="medical_ad_checklist.csv 경로(미지정 시 기본 경로/ /mnt/data 탐색)")
    parser.add_argument("--report-path", default="", help="medical-ad-report.md 경로(미지정 시 기본 경로/ /mnt/data 탐색)")
    parser.add_argument("--debug", action="store_true", help="추출 후보/경로 디버그 로그 저장")
    parser.add_argument("--evaluation-mode", default="medical", choices=["medical", "seo"], help="평가 모드 (medical: 의료법, seo: SEO 품질)")
    args = parser.parse_args()

    run(criteria_mode=args.criteria,
        max_loops=args.max_loops,
        auto_yes=args.auto_yes,
        log_dir=args.log_dir,
        pattern=args.pattern,
        debug=args.debug,
        csv_path=(args.csv_path or None),
        report_path=(args.report_path or None),
        evaluation_mode=args.evaluation_mode)