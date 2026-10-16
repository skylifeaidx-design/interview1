# 스카이라이프 홈페이지 기능 가이드북 v3.1

**운영 가이드북:** https://interview1-chi.vercel.app/

고객이 말한 표현으로 홈페이지 기능을 찾고, 이용 조건과 조치 순서를 확인해 안내합니다. 98개 기능·화면 예시와 별도로 ‘상담사 주요 QnA’에서 누구나 질문과 답변을 등록합니다. 통합 검색은 홈페이지 기능과 참여자 작성 QnA의 출처를 구분해 표시하며 질문·답변 본문도 검색합니다.

v3.1은 공식 FAQ의 주제를 참고하고 홈페이지 소스·공식 안내로 검토한 **110개 샘플 질문·답변**을 공유 게시합니다. 기존 이용자 글과 추가 답변은 보존합니다. 작성자는 ‘가이드북 샘플’로 명시하고 메뉴·노출 조건·관련 URL·확인 기준일을 제공합니다. [원고와 업데이트 안내](docs/QNA-SAMPLES.md)를 참고하세요.

## 로컬 실행

Node.js 20 이상을 사용합니다. 홈페이지 가이드는 정적 파일로 제공하며 공유 QnA는 `/api/qna`와 Vercel Private Blob 객체 저장소를 사용합니다. 데이터베이스에 연결하지 않습니다. 검색문장은 브라우저 안에서 처리합니다. 서버 의존성은 버전이 고정된 `@vercel/blob` SDK입니다.

```sh
npm ci --ignore-scripts
npm run check
npm run dev
```

미리보기는 `http://127.0.0.1:4180`에서 열립니다. `npm run build`는 검증된 파일만 `dist/`에 만듭니다. `dist/`는 수정하거나 커밋하지 않습니다.

공유 저장소가 없는 로컬 환경에서는 QnA 준비 중 안내가 표시됩니다. 자동검증용 임시 저장은 `QNA_LOCAL_TEST=1`을 명시한 로컬 미리보기에서만 사용합니다. 이 모드의 글은 재시작하면 사라지며 운영 저장소와 연결하지 않습니다. PowerShell에서는 `$env:QNA_LOCAL_TEST='1'; npm run dev`로 실행합니다.

## 콘텐츠 업데이트

- 기능 설명·대/중/소 분류·메뉴·단계·안내 문구: `content/features/<기능 ID>.json`
- 동의어·고객 표현·검색 의도·미지원 처리 안내: `content/search-dictionary.json`
- 확인 기준일·버전·링크 허용 도메인: `content/meta.json`
- 검토·마스킹이 끝난 화면: `public/screens/`
- UI: `src/index.html`, `src/styles.css`, `src/app.js`
- 검색 엔진: `src/search.js`
- 참여자 QnA 화면·검색: `src/qna.js`, `src/qna.css`, `src/qna-search.js`
- 공유 저장 API·권한·충돌 처리: `api/qna.js`, `server/qna-*.cjs`
- 검토한 샘플 원고·출처: `content/qna-samples.json`
- Production 샘플 게시·개정 보호: `server/qna-publication.cjs`

기존 기능의 ID는 공유 링크가 있으므로 유지합니다. JSON 편집기는 `content/feature.schema.json`으로 입력 항목을 안내합니다. 기능 내용이나 캡처를 변경하면 `availability.reviewedAt`과 `screen.captured`를 실제 확인일로 갱신합니다. 예시 화면은 `screen.kind: source` 및 예시 데이터임을 밝히는 캡션을 유지합니다.

## GitHub → Vercel

전용 GitHub 저장소에서 PR을 만들면 `.github/workflows/quality.yml`이 콘텐츠 검증·검색 테스트·빌드를 실행합니다. Vercel의 Git 연결은 해당 저장소를 선택합니다. 프로젝트는 Framework Preset `Other`, Build Command `npm run build`, Output Directory `dist`를 사용하도록 `vercel.json`에 선언했습니다.

권장 흐름은 브랜치에서 수정 → PR 검증 → Vercel Preview 확인 → 승인 후 main 병합 → Production 배포입니다. 실제 운영 브랜치와 연결 저장소는 Vercel 프로젝트 설정에서 확인한 값을 사용합니다. 기존 프로젝트에 다른 서비스가 있으면 Preview에서 검토한 뒤 적용합니다. `.gitlab-ci.yml`과 기존 홈페이지 배포·PM2 명령은 이 프로젝트에 포함하지 않습니다.

지정된 대상은 GitHub `skylifeaidx-design/interview1`, Vercel `skylifeaidxs-projects / interview1`입니다. 기존 인터뷰 사이트는 `archive/interview-site-20261015` 브랜치에 보관합니다. 기존 `/api/feedback`은 사용하지 않으며 공유 QnA에 한해 새 `/api/qna`를 제공합니다. Vercel Storage에서 **Private Blob을 Production 환경에 연결**해야 합니다. 설정·저장 범위·운영 관리는 [QnA 운영 안내](docs/QNA.md)를 참고하세요.

초기 가이드북 전환 이력은 [PR #1](https://github.com/skylifeaidx-design/interview1/pull/1)에 있습니다. HTML 저장 기능은 후속 요청에 따라 제거했습니다. 신규 공유 기능의 검증은 질문·답변 CRUD, 작성자 권한, 동시 저장, 검색과 실제 브라우저 동작을 포함합니다.

2026-10-15 QnA 운영 검증을 완료했습니다. 자동 테스트 155개와 빌드가 통과했고, 공개 운영 주소에서 기존 가이드 74개·두 독립 브라우저의 실제 공유 QnA 38개 항목이 통과했습니다. 질문·답변 등록, 본문 검색, 본인 수정·삭제와 타인 수정 차단을 확인했습니다. 테스트 글은 삭제했으며, 검증 중 사용한 한시적 정리 코드는 제거했습니다. 기능 추가는 [PR #2](https://github.com/skylifeaidx-design/interview1/pull/2), 실제 Vercel 인증·전송 버전 비교 보완은 PR #3·#4에 기록했습니다.

## 공유

운영 주소를 공유하거나 상세 안내의 ‘가이드 링크 복사’로 특정 기능을 공유합니다. HTML 저장 버튼과 단일 HTML 파일 생성·다운로드는 제거했습니다.

## 보안·검증

정적 배포 결과는 고정된 클라이언트 파일, 글꼴·로고, 기능 JSON이 참조하는 화면만 포함합니다. 공유 API와 저장 자격증명은 서버에만 둡니다. HTTPS 링크 허용 목록, 경로 경계, 필수 항목과 예시 구분을 검사하며 미참조 파일과 비밀 설정은 공개 배포하지 않습니다. 웹에는 CSP·클릭재킹 방지·MIME 추측 방지·Referrer/Permissions Policy 헤더를 적용합니다. 검색어와 작성 중 원고는 저장하지 않습니다. 즐겨찾기·최근 기능 ID, QnA 작성 권한용 무작위 키와 작성글 ID만 이 브라우저에 저장합니다.

UI/UX 세 차례 검토는 `docs/UX-REVIEW.md`, 검색 설계와 테스트는 `docs/SEARCH.md`, 보안 검토는 `docs/SECURITY-REVIEW.md`에서 확인합니다.

브라우저 검증은 선택 사항인 Playwright와 Edge로 `node execution/qa-ui.cjs`를 실행합니다. Playwright가 별도 경로에 설치되어 있으면 `PLAYWRIGHT_MODULE`로 지정합니다. 실행 중인 로컬 미리보기 또는 `GUIDE_TEST_URL`에 지정한 배포를 검사하고 결과는 `.tmp/ui-qa/`에 저장합니다. 이 도구는 운영 빌드에 포함되지 않습니다.

공유 QnA 브라우저 검증은 `node execution/qa-qna.cjs`입니다. 서로 다른 두 브라우저의 실제 공유 API에 **QA로 표시한 임시 질문·답변을 생성하고 본인 글만 삭제**하므로, 쓰기 검증이 허용된 대상에서 실행합니다. 기본 주소는 명시적 메모리 미리보기 `http://127.0.0.1:4190/`이며 배포 주소는 `GUIDE_TEST_URL`로 지정합니다. 결과에는 소유키·질문/답변 본문을 기록하지 않습니다.
