# 메디컨텐츠 QA 데모

메디컨텐츠 포스팅 생성 및 검토를 위한 데모 웹페이지입니다.

## 기능

### 포스팅 생성하기
- **수동 생성하기**: 진료 유형 선택 및 질문/답변 입력
- **진료 유형**: 신경치료, 임플란트, 교정치료, 보철치료, 예방치료
- **이미지 업로드**: 치료 전/중/후 사진 업로드 기능
- **Airtable 연동**: Medicontent Posts 및 Post Data Requests 테이블에 데이터 저장

### 포스팅 검토하기
- 생성된 포스팅 목록 조회 및 상태 확인
- Agent 실행 버튼으로 수동 처리 가능
- 실시간 상태 업데이트 (대기 → 처리 중 → 완료)

## 기술 스택

- **Frontend**: Next.js 14, React 18, TypeScript
- **Backend**: FastAPI, Python
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Database**: Airtable
- **AI Agents**: InputAgent, PlanAgent, TitleAgent, ContentAgent

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

## 데이터 구조

### Medicontent Posts 테이블
- Post Id: QA_로 시작하는 15자리 랜덤 문자열
- Title: "(작성 전) {Post Id}"
- Type: "전환 포스팅"
- Status: "리걸케어 작업 중"
- Treatment Type: 선택된 진료 유형

### Post Data Requests 테이블
- Post ID: Medicontent Posts와 동일한 Post Id
- Concept Message, Patient Condition 등 8개 질문에 대한 답변
- Before/Process/After Images: 이미지 첨부
- Status: "대기"

## 개발 참고사항

- 이미지 업로드 기능은 Airtable에 직접 업로드됩니다
- Agent 처리는 백그라운드에서 비동기적으로 실행됩니다
- 포스팅 생성 후 자동으로 Agent 처리가 시작됩니다
- 수동으로 Agent 실행도 가능합니다

## 프로세스 흐름

1. **포스팅 생성**: 사용자가 폼을 작성하고 '생성하기' 버튼 클릭
2. **Airtable 저장**: Medicontent Posts 및 Post Data Requests 테이블에 데이터 저장
3. **Agent 처리 시작**: Post ID를 사용하여 백엔드 API 호출
4. **AI Agent 실행**: InputAgent → PlanAgent → TitleAgent → ContentAgent 순서로 실행
5. **결과 저장**: 생성된 Title, Content, Plan, Evaluation을 Airtable에 저장
6. **상태 업데이트**: Medicontent Posts 테이블의 Status를 '리걸케어 작업 중'으로 변경
