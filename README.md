# CMS 상담사 인터뷰 사전자료 웹사이트

홈페이지 유입 상담과 CMS 상담업무 개선을 위한 상담사 인터뷰 사전자료입니다.

## 구성

- `public/index.html`: 상담사 공유용 웹페이지
- `public/assets/notion/`: Notion 기준지침에서 내려받은 업무 화면 캡처 이미지
- `api/feedback.js`: 상담사 의견을 Notion 데이터베이스에 저장하는 Vercel Serverless Function

## Notion 의견 DB

- DB 이름: CMS 상담사 의견 수렴
- DB ID: `396f46a3-8038-8168-8be6-e9f6423c71c0`

## Vercel 배포

1. GitHub 저장소 `skylifeaidx-design/interview1`를 Vercel에 Import합니다.
2. 현재 GitHub 저장소에는 이 폴더의 내용이 저장소 루트에 올라가 있으므로, Vercel의 Root Directory는 비워두거나 `./`로 둡니다.
   - Vercel Root Directory에 `cms-counselor-interview-site`를 입력하면 해당 경로가 저장소에 없어 빌드가 실패합니다.
3. Vercel 환경변수에 다음 값을 등록합니다.
   - `NOTION_TOKEN`
   - `NOTION_DATABASE_ID=396f46a3-8038-8168-8be6-e9f6423c71c0`
   - `NOTION_VERSION=2022-06-28`
4. 배포 후 웹페이지에서 의견 저장 버튼을 눌러 Notion DB 저장을 확인합니다.

GitHub Pages는 정적 페이지 배포만 가능하므로, Notion 저장 기능까지 사용하려면 Vercel 배포가 필요합니다.
