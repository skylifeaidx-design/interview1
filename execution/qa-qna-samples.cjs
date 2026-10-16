// Read-only browser QA. No authored content, baseline records, or browser screenshots are persisted.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const project = path.resolve(__dirname, '..');
const base = process.env.GUIDE_TEST_URL || 'http://127.0.0.1:4191/';
const origin = new URL(base).origin;
const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname);
const manifestPath = path.join(project, 'content', 'qna-samples.json');
const baselinePath = process.env.QNA_BASELINE_PATH || (isLocal ? null : path.join(project, '.tmp', 'qna-existing-before.json'));
const reportPath = path.join(project, '.tmp', 'qna-samples-qa', 'report.json');
const modulePath = process.env.PLAYWRIGHT_MODULE || 'C:/Users/KTSKYLIFE/AppData/Local/npm-cache/_npx/86170c4cd1c5da32/node_modules/playwright';
const sourceHosts = new Set(['www.skylife.co.kr', 'corp.skylife.co.kr', 'interview1-chi.vercel.app', 'speed.nia.or.kr']);
const results = [], skipped = [];
const screenshots = [];
const counts = { runtimeErrors: 0, cspErrors: 0, externalRequests: 0, writeRequests: 0, searchTermRequests: 0 };
const searchedTerms = new Set();
let browser, context, page, stageName = '초기화', samples = [], allQuestions = [], sampleQuestions = [];

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
function assert(condition, name) {
  results.push({ name, pass: !!condition });
  if (!condition) throw Error('검증 실패');
}
async function stage(name, run) { stageName = name; await run(); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function publicRecord(question) {
  const fields = ['id', 'title', 'body', 'category', 'tags', 'author', 'createdAt', 'updatedAt', 'version', 'answers'];
  return Object.fromEntries(fields.filter(key => Object.hasOwn(question, key)).map(key => [key, question[key]]));
}
function containsPrivateMetadata(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => /^(ownerKey|ownerHash|rateSalt|rates|audit|tombstones|ip|ipHash)$/i.test(key) || containsPrivateMetadata(child));
}
async function ready() {
  await page.locator('#cards .card').first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('#qna-refresh')?.textContent === '새로고침', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
}
async function openQna() {
  if (await page.locator('#qna-section').isVisible()) return;
  if (await page.locator('#mobile-menu').isVisible() && !(await page.locator('#sidebar').evaluate(node => node.classList.contains('open')))) await page.locator('#mobile-menu').click();
  await page.locator('#qna-nav').click();
  await page.locator('#qna-section').waitFor({ state: 'visible' });
}
async function closeThread() {
  if (await page.locator('#qna-thread-dialog').evaluate(node => node.open)) await page.locator('[data-qna-close-thread]').first().click();
}
async function search(query) {
  searchedTerms.add(query);
  await page.locator('#search').fill(query);
  await page.locator('#search-form [type="submit"]').click();
  await page.waitForFunction(value => document.querySelector('#search')?.value === value && document.querySelector('#search-suggestions')?.hidden, query);
}
function card(question) { return page.locator('#qna-list [data-qna-question="' + question.id + '"]'); }
async function openQuestion(question) {
  await card(question).locator('[data-qna-open]').click();
  await page.locator('#qna-thread-dialog').waitFor({ state: 'visible' });
}
async function readQuestions() {
  // A page fetch uses Edge's operating-system trust; TLS verification stays enabled.
  return page.evaluate(async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
    try {
      const response = await fetch('/api/qna', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      return { ok: response.ok, configured: data.configured, questions: data.questions, privateMetadata: !!data.ownerKey || !!data.ownerHash || !!data.rates || !!data.audit };
    } finally { clearTimeout(timer); }
  });
}
async function safeContent() {
  return page.locator('#qna-thread-body .qna-thread-text, #qna-thread-body .qna-answer-text').evaluateAll(nodes => nodes.every(node => {
    if (node.querySelector('script,iframe,object,embed,svg,img,style,link,form,input,button')) return false;
    return [...node.querySelectorAll('*')].every(child => child.tagName === 'A' && ![...child.attributes].some(attribute => /^on/i.test(attribute.name)));
  }));
}
async function links() {
  return page.locator('#qna-thread-body .qna-reference-link').evaluateAll(nodes => nodes.map(node => ({ href: node.href, target: node.target, rel: node.rel })));
}
function safeLink(link) {
  try {
    const url = new URL(link.href);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && sourceHosts.has(url.hostname) && link.target === '_blank' && /\bnoopener\b/.test(link.rel) && /\bnoreferrer\b/.test(link.rel);
  } catch { return false; }
}
async function widthSafe() {
  return page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
}

(async () => {
  try {
    await stage('샘플 manifest 준비', async () => {
      const manifest = readJson(manifestPath);
      samples = manifest.questions;
      assert(Array.isArray(samples) && samples.length >= 100, '게시 manifest에 샘플 질문 100개 이상');
      assert(new Set(samples.map(question => question.key)).size === samples.length && new Set(samples.map(question => question.title)).size === samples.length, '전체 샘플 키와 제목 중복 없음');
      assert(samples.every(question => typeof question.body === 'string' && typeof question.answer === 'string' && question.body.length && question.answer.length), '모든 샘플의 질문과 답변 원고 존재');
    });
    await stage('읽기 전용 브라우저 준비', async () => {
      const { chromium } = require(modulePath);
      browser = await chromium.launch({ channel: 'msedge', headless: true });
      context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ko-KR' });
      await context.route('**/*', async route => {
        const request = route.request();
        if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { counts.writeRequests++; return route.abort('blockedbyclient'); }
        if (new URL(request.url()).origin !== origin) { counts.externalRequests++; return route.abort('blockedbyclient'); }
        return route.continue();
      });
      page = await context.newPage();
      page.on('pageerror', () => counts.runtimeErrors++);
      page.on('console', message => { if (message.type() === 'error' && /content security|violates|refused to/i.test(message.text())) counts.cspErrors++; });
      page.on('request', request => {
        let parsed; try { parsed = new URL(request.url()); } catch { return; }
        for (const term of searchedTerms) if (term && (parsed.search.includes(term) || parsed.search.includes(encodeURIComponent(term)))) { counts.searchTermRequests++; break; }
      });
      const response = await page.goto(base, { waitUntil: 'load' });
      await ready();
      assert(response.ok(), '배포 페이지 정상 응답');
      assert(response.headers()['content-security-policy']?.includes("script-src 'self'"), '엄격한 스크립트 CSP 적용');
      assert(await page.locator('#cards .card').count() === 98, '기존 홈페이지 기능 98개 유지');
    });
    await stage('공유 샘플 및 기존 질문 보존', async () => {
      const api = await readQuestions();
      assert(api.ok && api.configured === true && Array.isArray(api.questions), '공유 QnA API 정상 조회');
      allQuestions = api.questions;
      assert(!api.privateMetadata && !containsPrivateMetadata(allQuestions), '공유 응답에 작성권한·내부 메타데이터 미노출');
      for (const [index, sample] of samples.entries()) {
        const matches = allQuestions.filter(question => question.title === sample.title && question.author === '가이드북 샘플');
        assert(matches.length === 1, '샘플 ' + String(index + 1).padStart(3, '0') + ' 질문 한 번만 게시');
        const question = matches[0];
        assert(question.body === sample.body && question.category === sample.category, '샘플 ' + String(index + 1).padStart(3, '0') + ' 질문·분류 원고 일치');
        assert(question.answers.filter(answer => answer.body === sample.answer && answer.author === '가이드북 샘플').length === 1, '샘플 ' + String(index + 1).padStart(3, '0') + ' 답변 한 번만 게시');
        sampleQuestions.push(question);
      }
      if (baselinePath) {
        const baseline = readJson(baselinePath);
        assert(Array.isArray(baseline.questions), '기존 질문 보존 비교 자료 확인');
        assert(baseline.questions.every(before => {
          const after = allQuestions.find(question => question.id === before.id);
          return after && JSON.stringify(stable(publicRecord(after))) === JSON.stringify(stable(publicRecord(before)));
        }), '기존 참여자 질문과 답변 내용·상태 보존');
      } else skipped.push({ name: '로컬 임시 저장소의 운영 기존글 비교 생략' });
    });
    await stage('전체 샘플 목록과 본문 표시', async () => {
      await openQna();
      await search('');
      assert(await page.locator('#qna-list .qna-card').count() === allQuestions.length, '전체 샘플과 기존 공유 질문 목록 표시');
      if (isLocal && allQuestions.length === sampleQuestions.length) {
        const file = path.join(path.dirname(reportPath), 'samples-desktop.png');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        await page.screenshot({ path: file });
        screenshots.push(file);
      }
      let checkedLinkCount = 0, checkedGuideLinkCount = 0;
      for (const [index, question] of sampleQuestions.entries()) {
        const sample = samples[index], label = '샘플 ' + String(index + 1).padStart(3, '0');
        await openQuestion(question);
        assert(await page.locator('#qna-thread-title').textContent() === sample.title && await page.locator('#qna-thread-body .qna-thread-text').textContent() === sample.body, label + ' 제목·질문 전체 표시');
        assert((await page.locator('#qna-thread-body .qna-answer-text').allTextContents()).includes(sample.answer), label + ' 답변 전체 표시');
        const references = await links();
        assert(references.length > 0 && references.every(safeLink), label + ' 공식·가이드 출처 링크 안전하게 새 창 연결');
        assert(references.some(link => ['www.skylife.co.kr', 'corp.skylife.co.kr'].includes(new URL(link.href).hostname)) && references.some(link => new URL(link.href).hostname === 'interview1-chi.vercel.app' && new URL(link.href).hash.startsWith('#guide=')), label + ' 공식 홈페이지 출처와 관련 기능 가이드 모두 표시');
        assert(await safeContent(), label + ' 본문을 실행 요소 없이 일반 텍스트로 표시');
        checkedLinkCount += references.length;
        checkedGuideLinkCount += references.filter(link => new URL(link.href).hostname === 'interview1-chi.vercel.app' && new URL(link.href).hash.startsWith('#guide=')).length;
        assert(new URL(page.url()).search === '' && new URLSearchParams(new URL(page.url()).hash.slice(1)).get('qna') === question.id, label + ' 직접 링크에는 질문 ID만 포함');
        await closeThread();
      }
      assert(checkedLinkCount >= samples.length && checkedGuideLinkCount >= samples.length, '모든 샘플의 홈페이지 출처와 관련 기능 가이드 연결');
    });
    await stage('분류와 답변 상태 필터', async () => {
      await search('');
      for (const category of [...new Set(samples.map(question => question.category))]) {
        await page.locator('#qna-category').selectOption(category);
        const expected = allQuestions.filter(question => question.category === category).length;
        assert(await page.locator('#qna-list .qna-card').count() === expected, '샘플 분류 필터 ' + category);
      }
      await page.locator('#qna-category').selectOption('');
      await page.locator('#qna-tab-answered').click();
      assert(await page.locator('#qna-list .qna-card').count() === allQuestions.filter(question => question.answers.length).length, '답변 있음 필터에 모든 답변된 샘플 포함');
      await page.locator('#qna-tab-waiting').click();
      assert(await page.locator('#qna-list .qna-card').count() === allQuestions.filter(question => !question.answers.length).length, '답변 대기 필터에 답변된 샘플 제외');
      await page.locator('#qna-tab-mine').click();
      assert(await page.locator('#qna-list .qna-card').count() === 0, '읽기 전용 새 브라우저의 내 글 비어 있음');
      await page.locator('#qna-tab-all').click();
    });
    await stage('대표 질문과 답변 본문 검색', async () => {
      const sampleIds = new Set(sampleQuestions.map(question => question.id));
      for (const query of ['eSIM', '이전설치', '청구서', '비밀번호', '사업자', 'A/S 취소', '카카오페이', '데이터', '요금제 변경', 'S-머니']) {
        await search(query);
        const matches = await page.locator('#qna-list [data-qna-question]').evaluateAll(nodes => nodes.map(node => node.dataset.qnaQuestion));
        assert(matches.some(id => sampleIds.has(id)), '대표 검색에서 관련 샘플 발견: ' + query);
        assert(new URL(page.url()).search === '' && !page.url().includes(encodeURIComponent(query)), '대표 검색어 URL 미기록: ' + query);
      }
      for (const query of ['예금주', '재결제']) {
        const target = sampleQuestions.find(question => question.answers.some(answer => answer.body.includes(query)) && ![question.title, question.body, ...question.tags].join(' ').includes(query));
        assert(!!target, '답변 본문 전용 검색 사례 존재: ' + query);
        await search(query);
        assert(await card(target).count() === 1, '질문에 없는 답변 본문 용어로 검색: ' + query);
      }
      await search('');
      await page.locator('[data-home]').click();
      await search('요금');
      assert(await page.locator('.library').isVisible() && await page.locator('#cards .card').count() > 0, '통합 검색에 원본 홈페이지 기능 표시');
      assert(await page.locator('#qna-global-results').isVisible() && await page.locator('#qna-global-list .qna-card').count() > 0, '통합 검색에 별도 QnA 결과 표시');
      assert((await page.locator('#qna-global-results').textContent()).includes('참여자') && (await page.locator('.library .eyebrow').textContent()).includes('기능 라이브러리'), '원본 기능과 참여자 QnA 출처 구분');
      const privacyQuery = '샘플검색비저장검증' + randomUUID().replaceAll('-', '');
      await search(privacyQuery);
      assert(!page.url().includes(privacyQuery) && !page.url().includes(encodeURIComponent(privacyQuery)), '임의 검색어 URL 미기록');
      assert(await page.evaluate(query => !Object.values({ ...localStorage, ...sessionStorage }).some(value => String(value).includes(query)), privacyQuery), '임의 검색어 브라우저 저장소 미기록');
      await search('');
    });
    await stage('390·320px에서 전체 목록과 출처 표시', async () => {
      const longest = [...sampleQuestions].sort((a, b) => Math.max(...b.answers.map(answer => answer.body.length)) - Math.max(...a.answers.map(answer => answer.body.length)))[0];
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await openQna();
        await search('');
        assert(await page.locator('#qna-list .qna-card').count() === allQuestions.length, width + 'px 전체 공유 목록 누락 없음');
        for (const ratio of [0, 0.5, 1]) {
          await page.evaluate(value => window.scrollTo(0, document.documentElement.scrollHeight * value), ratio);
          assert(await widthSafe(), width + 'px 전체 목록 가로 넘침 없음 ' + ratio);
        }
        await openQuestion(longest);
        assert(await page.locator('#qna-thread-dialog').evaluate(node => node.scrollWidth <= node.clientWidth + 1), width + 'px 긴 질문·답변 창 가로 넘침 없음');
        assert((await links()).every(safeLink), width + 'px 출처 링크의 안전 속성 유지');
        assert(await safeContent(), width + 'px 긴 본문 실행 요소 없음');
        if (width === 390 && isLocal && allQuestions.length === sampleQuestions.length) {
          const file = path.join(path.dirname(reportPath), 'samples-mobile.png');
          fs.mkdirSync(path.dirname(file), { recursive: true });
          await page.screenshot({ path: file });
          screenshots.push(file);
        }
        await closeThread();
      }
    });
    await stage('읽기 전용과 오류·검색 개인정보 경계', async () => {
      assert(counts.writeRequests === 0, '질문·답변 등록·수정·삭제 요청 없음');
      assert(counts.externalRequests === 0, '외부 출처로 게시글·검색어 전송 없음');
      assert(counts.searchTermRequests === 0, '네트워크 요청 URL에 검색어 미기록');
      assert(counts.runtimeErrors === 0, 'JavaScript 실행 오류 없음');
      assert(counts.cspErrors === 0, 'CSP 위반 없음');
      assert(await page.evaluate(() => !localStorage.getItem('skylife-qna:owner-key') && !localStorage.getItem('skylife-qna:owned')), '조회만으로 작성 권한이나 내 글 기록 생성 안함');
    });
  } catch {
    // Browser and selector errors can contain shared authored text; persist check names only.
    if (!results.length || results.at(-1).pass) results.push({ name: stageName + ' 실행', pass: false });
  } finally {
    if (browser) await browser.close().catch(() => {});
    const report = { passed: results.filter(result => result.pass).length, failed: results.filter(result => !result.pass).length, skipped: skipped.length, sampleCount: samples.length, sharedQuestionCount: allQuestions.length, results, skippedChecks: skipped, ...counts };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, skipped: report.skipped, sampleCount: report.sampleCount, sharedQuestionCount: report.sharedQuestionCount, failures: results.filter(result => !result.pass), report: reportPath, screenshots, ...counts }, null, 2));
    if (report.failed) process.exitCode = 1;
  }
})();
