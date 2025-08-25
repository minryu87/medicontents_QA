# 메디컨텐츠 QA 데모

메디컨텐츠 포스팅 생성 및 검토를 위한 데모 웹페이지입니다.

## 기능

### 포스팅 생성하기
- **수동 생성하기**: 진료 유형 선택 및 질문/답변 입력
- **진료 유형**: 신경치료, 임플란트, 교정치료, 보철치료, 예방치료
- **이미지 업로드**: 치료 전/중/후 사진 업로드 기능
- **Airtable 연동**: Medicontent Posts 및 Post Data Requests 테이블에 데이터 저장

### 포스팅 검토하기
- 생성된 포스팅을 검토하고 관리할 수 있는 영역 (구현 예정)

## 기술 스택

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Database**: Airtable

## 설치 및 실행

1. 의존성 설치:
```bash
npm install
```

2. 개발 서버 실행:
```bash
npm run dev
```

3. 브라우저에서 `http://localhost:3000` 접속

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

- 이미지 업로드 기능은 현재 데모용으로 구현되어 있습니다
- 실제 이미지 업로드 API 연동이 필요합니다
- 포스팅 검토 기능은 향후 구현 예정입니다
