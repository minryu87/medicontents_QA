# 메디컨텐츠 QA 데모

메디컨텐츠 포스팅 생성 및 검토를 위한 데모 웹페이지입니다.

## 기능

### 포스팅 생성하기
- **수동 생성하기**: 진료 유형 선택 및 질문/답변 입력
- **자동 생성하기**: n8n 웹훅을 통한 대량 포스팅 생성 (1-100개)
- **진료 유형**: 신경치료, 임플란트, 교정치료, 보철치료, 예방치료
- **이미지 업로드**: 치료 전/중/후 사진 업로드 기능
- **Airtable 연동**: Medicontent Posts 및 Post Data Requests 테이블에 데이터 저장

### 포스팅 검토하기
- 생성된 포스팅 목록 조회 및 상태 확인
- QA 검토 기능: 검토자, 내용검토, 의료법검토, 기타 검토
- 5점 척도 평점 시스템 (컨텐츠 점수, 의료법 점수)
- 색상 코딩: 녹색(4점 이상), 노란색(3점 이하), 빨간색(1점 이하)
- Agent 실행 버튼으로 수동 처리 가능
- 실시간 상태 업데이트 (대기 → 처리 중 → 완료)

### 실시간 모니터링
- **수동 생성**: 실시간 로그 폴링으로 Agent 작업 진행 상황 표시
- **자동 생성**: Airtable Status 모니터링으로 완료 상태 추적
- **진행 상황 표시**: 전체 개수 대비 진행 중/완료 개수 실시간 업데이트

## 기술 스택

- **Frontend**: Next.js 14, React 18, TypeScript
- **Backend**: FastAPI, Python
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Database**: Airtable
- **AI Agents**: InputAgent, PlanAgent, TitleAgent, ContentAgent, EvaluationAgent
- **Workflow Automation**: n8n
- **Deployment**: Docker, Elestio

## 설치 및 실행

### Frontend (Next.js)
1. 의존성 설치:
```bash
npm install
```

2. 개발 서버 실행:
```bash
npm run dev
```

3. 브라우저에서 `http://localhost:3000` 접속

### Backend (FastAPI)
1. Python 의존성 설치:
```bash
cd api
pip install -r requirements.txt
```

2. FastAPI 서버 실행:
```bash
cd api
python main.py
```

3. API 서버는 `http://localhost:8000`에서 실행됩니다

## Airtable 설정

- **API Key**: `pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9`
- **Base ID**: `appa5Q0PYdL5VY3RK`

## 환경 변수

### Frontend (.env.local)
```
AIRTABLE_API_KEY=pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9
AIRTABLE_BASE_ID=appa5Q0PYdL5VY3RK
```

### Backend (.env)
```
AIRTABLE_API_KEY=pat6S8lzX8deRFTKC.0e92c4403cdc7878f8e61f815260852d4518a0b46fa3de2350e5e91f4f0f6af9
AIRTABLE_BASE_ID=appa5Q0PYdL5VY3RK
GEMINI_API_KEY=your_gemini_api_key_here
AGENTS_BASE_PATH=/path/to/agents/directory
```

## 데이터 구조

### Medicontent Posts 테이블
- **Post Id**: QA_로 시작하는 15자리 랜덤 문자열
- **Title**: "(작성 전) {Post Id}" → Agent 완료 후 실제 제목으로 업데이트
- **Type**: "전환 포스팅"
- **Status**: "리걸케어 작업 중" → "작업 완료" (n8n 완료 후)
- **Treatment Type**: 선택된 진료 유형
- **Content**: Agent가 생성한 HTML 콘텐츠 (n8n 완료 후)
- **QA_yn**: QA 검토 완료 여부 (Checkbox)
- **QA_by**: QA 담당자 (Single select)
- **QA_content**: 내용검토 의견 (Long text)
- **QA_content_score**: 내용검토 점수 (Rating 1-5)
- **QA_legal**: 의료법검토 의견 (Long text)
- **QA_legal_score**: 의료법검토 점수 (Rating 1-5)
- **QA_etc**: 기타 검토 의견 (Long text)
- **QA_date**: QA 일자 (Date)

### Post Data Requests 테이블
- **Post ID**: Medicontent Posts와 동일한 Post Id
- **Concept Message**: 1번 질문 답변
- **Patient Condition**: 2번 질문 답변
- **Treatment Process Message**: 3번 질문 답변
- **Treatment Result Message**: 4번 질문 답변
- **Additional Message**: 5번 질문 답변
- **Before Images Texts**: 6번 질문 답변
- **Process Images Texts**: 7번 질문 답변
- **After Images Texts**: 8번 질문 답변
- **Before/Process/After Images**: 이미지 첨부
- **Status**: "대기" → "처리 중" → "완료"
- **Title**: Agent가 생성한 제목
- **Content**: Agent가 생성한 콘텐츠
- **Plan**: Agent가 생성한 계획
- **Evaluation**: Agent가 생성한 평가

## Agent 시스템 상세

### Agent API 엔드포인트

#### 1. Agent 실행 API
```
POST /api/process-post
Content-Type: application/json

{
  "post_id": "QA_xxxxxxxxxxxxx"
}
```

#### 2. 로그 조회 API
```
GET /api/get-logs/{post_id}
```

#### 3. n8n 완료 확인 API
```
POST /api/n8n-completion
Content-Type: application/json

{
  "post_id": "QA_xxxxxxxxxxxxx",
  "workflow_id": "medicontent_autoblog_QA_manual",
  "timestamp": "2025-08-26T05:31:57.942-04:00",
  "n8n_result": "success"
}
```

### Agent 실행 순서

1. **InputAgent**: Post Data Requests 테이블에서 입력 데이터 조회
2. **PlanAgent**: 치료 계획 및 콘텐츠 구조 설계
3. **TitleAgent**: 포스팅 제목 생성
4. **ContentAgent**: HTML 콘텐츠 생성
5. **EvaluationAgent**: 생성된 콘텐츠 평가

### Agent 파일 구조
```
agents/
├── input_agent.py      # 입력 데이터 처리
├── plan_agent.py       # 계획 수립
├── title_agent.py      # 제목 생성
├── content_agent.py    # 콘텐츠 생성
├── evaluation_agent.py # 평가 생성
├── utils/
│   ├── sample_images/  # 샘플 이미지 파일들
│   └── prompts/        # Agent 프롬프트 파일들
└── config/
    └── agent_config.json
```

### Agent 업데이트 시 주의사항

1. **API 호출 방식 유지**: `/api/process-post` 엔드포인트는 그대로 유지
2. **Airtable 필드명 일치**: Post Data Requests 테이블의 필드명과 정확히 일치해야 함
3. **로그 출력 형식**: `INFO`, `ERROR`, `WARNING` 레벨로 로그 출력
4. **환경 변수**: `AGENTS_BASE_PATH`로 Agent 파일 경로 설정
5. **이미지 처리**: `agents/utils/sample_images/` 경로의 이미지 파일들 참조

## 개발 참고사항

- 이미지 업로드 기능은 Airtable에 직접 업로드됩니다
- Agent 처리는 백그라운드에서 비동기적으로 실행됩니다
- 포스팅 생성 후 자동으로 Agent 처리가 시작됩니다
- 수동으로 Agent 실행도 가능합니다
- 실시간 로그 폴링으로 Agent 진행 상황을 모니터링합니다

## 프로세스 흐름

### 수동 생성 프로세스
1. **포스팅 생성**: 사용자가 폼을 작성하고 '생성하기' 버튼 클릭
2. **Airtable 저장**: Medicontent Posts 및 Post Data Requests 테이블에 데이터 저장
3. **Agent 처리 시작**: Post ID를 사용하여 `/api/process-post` API 호출
4. **AI Agent 실행**: InputAgent → PlanAgent → TitleAgent → ContentAgent → EvaluationAgent 순서로 실행
5. **결과 저장**: 생성된 Title, Content, Plan, Evaluation을 Post Data Requests 테이블에 저장
6. **n8n 워크플로우**: Agent 완료 후 n8n이 Post Data Requests의 Content를 HTML로 변환하여 Medicontent Posts 테이블에 저장
7. **상태 업데이트**: Medicontent Posts 테이블의 Status를 '작업 완료'로 변경

### 자동 생성 프로세스
1. **웹훅 호출**: n8n 웹훅에 진료 유형과 개수 전송
2. **Post ID 생성**: n8n에서 여러 개의 Post ID 생성
3. **초기 데이터 생성**: Medicontent Posts 및 Post Data Requests 테이블에 초기 데이터 저장
4. **Agent 호출**: 각 Post ID에 대해 `/api/process-post` API 호출
5. **Agent 실행**: 각 Post ID별로 Agent 체인 실행
6. **n8n 후속 처리**: Agent 완료 후 n8n이 HTML 변환 및 최종 저장
7. **완료 감지**: Airtable Status 모니터링으로 완료 상태 추적

## n8n 웹훅 설정

### 자동 생성 웹훅
```
URL: https://medisales-u45006.vm.elestio.app/webhook/f9cb5f6a-a22b-4141-8e6a-69373d0301d1
Method: POST
Content-Type: application/json

Body:
{
  "treatmentType": "임플란트",
  "count": 5,
  "timestamp": "2025-08-26T18:42:48.123Z",
  "source": "medicontents_QA_auto"
}
```

### n8n 완료 콜백
n8n 워크플로우 완료 시 `/api/n8n-completion` API를 호출하여 완료 상태를 백엔드에 전달합니다.

## 배포

### Docker 빌드
```bash
# 이미지 빌드
docker build -t medicontents-qa .

# 컨테이너 실행
docker run -p 3000:3000 medicontents-qa
```

### Elestio 배포
1. GitHub 저장소에 Dockerfile과 .dockerignore 포함하여 푸시
2. Elestio에서 GitHub 저장소 연결
3. 자동 빌드 및 배포

### 환경 변수 설정 (배포 시)
- `AIRTABLE_API_KEY`: Airtable API 키
- `AIRTABLE_BASE_ID`: Airtable Base ID
- `GEMINI_API_KEY`: Gemini API 키 (백엔드)
- `AGENTS_BASE_PATH`: Agent 파일 경로 (백엔드)

## 파일 구조

```
medicontents_QA/
├── src/
│   └── app/
│       ├── page.tsx          # 메인 페이지 (포스팅 생성/검토)
│       └── globals.css       # 전역 스타일
├── api/
│   ├── main.py              # FastAPI 메인 서버
│   ├── services/
│   │   └── medicontent_service.py  # Airtable 연동 서비스
│   └── requirements.txt     # Python 의존성
├── agents/                  # AI Agent 파일들
├── public/                  # 정적 파일 (Docker 배포용)
├── Dockerfile              # Docker 설정
├── .dockerignore           # Docker 제외 파일
├── package.json            # Node.js 의존성
└── README.md               # 프로젝트 문서
```
