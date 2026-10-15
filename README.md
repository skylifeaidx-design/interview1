# 스카이라이프 홈페이지 기능 가이드북 v2

**운영 가이드북:** https://interview1-chi.vercel.app/

고객이 말한 표현으로 홈페이지 기능을 찾고, 이용 조건과 조치 순서를 확인해 안내하는 정적 웹페이지입니다. 98개 기능·화면 예시를 유지하며 검색 의도 구분, 일치 근거, 자동완성, 조건 필터, 단계별 안내를 제공합니다.

## 로컬 실행

Node.js 20 이상을 사용합니다. 외부 npm 의존성, 데이터베이스, 서버 API, 검색문장 전송이 없습니다.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

미리보기는 `http://127.0.0.1:4180`에서 열립니다. `npm run build`는 검증된 파일만 `dist/`에 만듭니다. `dist/`는 수정하거나 커밋하지 않습니다.

## 콘텐츠 업데이트

- 기능 설명·대/중/소 분류·메뉴·단계·안내 문구: `content/features/<기능 ID>.json`
- 동의어·고객 표현·검색 의도·미지원 처리 안내: `content/search-dictionary.json`
- 확인 기준일·버전·링크 허용 도메인: `content/meta.json`
- 검토·마스킹이 끝난 화면: `public/screens/`
- UI: `src/index.html`, `src/styles.css`, `src/app.js`
- 검색 엔진: `src/search.js`

기존 기능의 ID는 공유 링크가 있으므로 유지합니다. JSON 편집기는 `content/feature.schema.json`으로 입력 항목을 안내합니다. 기능 내용이나 캡처를 변경하면 `availability.reviewedAt`과 `screen.captured`를 실제 확인일로 갱신합니다. 예시 화면은 `screen.kind: source` 및 예시 데이터임을 밝히는 캡션을 유지합니다.

## GitHub → Vercel

전용 GitHub 저장소에서 PR을 만들면 `.github/workflows/quality.yml`이 콘텐츠 검증·검색 테스트·빌드를 실행합니다. Vercel의 Git 연결은 해당 저장소를 선택합니다. 프로젝트는 Framework Preset `Other`, Build Command `npm run build`, Output Directory `dist`를 사용하도록 `vercel.json`에 선언했습니다.

권장 흐름은 브랜치에서 수정 → PR 검증 → Vercel Preview 확인 → 승인 후 main 병합 → Production 배포입니다. 실제 운영 브랜치와 연결 저장소는 Vercel 프로젝트 설정에서 확인한 값을 사용합니다. 기존 프로젝트에 다른 서비스가 있으면 Preview에서 검토한 뒤 적용합니다. `.gitlab-ci.yml`과 기존 홈페이지 배포·PM2 명령은 이 프로젝트에 포함하지 않습니다.

지정된 대상은 GitHub `skylifeaidx-design/interview1`, Vercel `skylifeaidxs-projects / interview1`입니다. 기존 인터뷰 사이트는 `archive/interview-site-20261015` 브랜치에 보관합니다. 새 버전은 기존 의견 저장 서버 함수를 포함하지 않는 정적 가이드북입니다. 배포 성공과 공개 접속 여부는 실제 Vercel 결과로 확인합니다.

2026-10-15 운영 배포를 확인했습니다. GitHub 자동검사 103개와 운영 주소의 실제 브라우저 검증 82개가 통과했습니다. 로그인 없는 접속, HTML 다운로드·오프라인 실행·공개 주소 공유, 기존 `/api/feedback`의 404 응답을 확인했습니다. 구현 전환 이력은 [PR #1](https://github.com/skylifeaidx-design/interview1/pull/1)에 있습니다.

## 공유

운영 주소를 공유하거나 상세 안내의 ‘가이드 링크 복사’로 특정 기능을 공유합니다. HTML 저장 버튼과 단일 HTML 파일 생성·다운로드는 제거했습니다.

## 보안·검증

배포 결과는 고정된 클라이언트 파일, 글꼴·로고, 기능 JSON이 참조하는 화면만 포함합니다. HTTPS 링크 허용 목록, 경로 경계, 필수 항목과 예시 구분을 검사하며 미참조 파일과 비밀 설정은 배포하지 않습니다. 웹에는 CSP·클릭재킹 방지·MIME 추측 방지·Referrer/Permissions Policy 헤더를 적용합니다. 검색어는 저장하거나 전송하지 않고 즐겨찾기·최근 기능 ID만 이 브라우저에 저장합니다.

UI/UX 세 차례 검토는 `docs/UX-REVIEW.md`, 검색 설계와 테스트는 `docs/SEARCH.md`, 보안 검토는 `docs/SECURITY-REVIEW.md`에서 확인합니다.

브라우저 검증은 선택 사항인 Playwright와 Edge로 `node execution/qa-ui.cjs`를 실행합니다. Playwright가 별도 경로에 설치되어 있으면 `PLAYWRIGHT_MODULE`로 지정합니다. 실행 중인 로컬 미리보기 또는 `GUIDE_TEST_URL`에 지정한 배포를 검사하고 결과는 `.tmp/ui-qa/`에 저장합니다. 이 도구는 운영 빌드에 포함되지 않습니다.
