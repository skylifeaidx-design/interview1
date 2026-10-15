// Optional browser QA. Test ownership keys and authored content stay in process memory.
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const project = path.resolve(__dirname, '..');
const base = process.env.GUIDE_TEST_URL || 'http://127.0.0.1:4190/';
const origin = new URL(base).origin;
const reportPath = path.join(project, '.tmp', 'qna-qa', 'report.json');
const run = randomUUID().replaceAll('-', '');
const marker = 'QA-QNA-' + run;
const title = marker + ' 상담 질문';
const editedTitle = marker + ' 수정한 상담 질문';
const questionBody = 'QA 자동 검증용 질문입니다. 실제 고객 정보가 없으며 검증 후 삭제합니다.';
const answerToken = '검증답변검색' + run;
const editedAnswerToken = '수정답변검색' + run;
const answerBody = answerToken + ' 참여자 답변 본문 검색을 확인하는 임시 내용입니다.';
const editedAnswerBody = editedAnswerToken + ' 본인이 수정한 임시 답변입니다.';
const author = 'QA 자동검증';
const results = [], runtimeErrors = [], cspErrors = [], externalRequests = [];
let browser, contextA, contextB, pageA, pageB, questionId, answerId, ownerA, ownerB, currentStage = '초기화';
const validQuestionId = value => typeof value === 'string' && /^q-[a-z0-9-]{1,80}$/i.test(value);
const validAnswerId = value => typeof value === 'string' && /^a-[a-z0-9-]{1,80}$/i.test(value);
function assert(condition, name) {
  results.push({ name, pass: !!condition });
  if (!condition) throw Error('검증 실패');
}
async function stage(name, runStage) { currentStage = name; await runStage(); }
async function ready(page) {
  await page.locator('.card').first().waitFor({ timeout: 25000 });
  await page.waitForFunction(() => document.querySelector('#qna-refresh')?.textContent === '새로고침', { timeout: 25000 });
  await page.evaluate(() => document.fonts.ready);
}
async function openQna(page) {
  if (await page.locator('#qna-section').isVisible()) return;
  if (await page.locator('#mobile-menu').isVisible() && !(await page.locator('#sidebar').evaluate(n => n.classList.contains('open')))) await page.locator('#mobile-menu').click();
  await page.locator('#qna-nav').click();
  await page.locator('#qna-section').waitFor({ state: 'visible' });
}
async function closeThread(page) {
  if (await page.locator('#qna-thread-dialog').evaluate(node => node.open)) await page.locator('[data-qna-close-thread]').first().click();
}
async function refresh(page) {
  await closeThread(page);
  const response = page.waitForResponse(r => r.url() === origin + '/api/qna' && r.request().method() === 'GET');
  await page.locator('#qna-refresh').click();
  await response;
  await page.waitForFunction(() => document.querySelector('#qna-refresh')?.textContent === '새로고침');
}
async function search(page, query) {
  await page.locator('#search').fill(query);
  await page.locator('#search-form [type="submit"]').click();
  await page.waitForFunction(value => document.querySelector('#search')?.value === value && document.querySelector('#search-suggestions')?.hidden, query);
}
function card(page) { return page.locator('#qna-list [data-qna-question="' + questionId + '"]'); }
async function openOwnQuestion(page) {
  await card(page).locator('[data-qna-open]').click();
  await page.locator('#qna-thread-dialog').waitFor({ state: 'visible' });
}
async function readOwner(page) {
  if (!page || page.isClosed()) return null;
  const value = await page.evaluate(() => localStorage.getItem('skylife-qna:owner-key'));
  return /^[A-Za-z0-9_-]{43}$/.test(value || '') ? value : null;
}
async function listQuestions(page) {
  // Use Edge's OS certificate trust for corporate proxies; do not bypass TLS verification.
  const result = await page.evaluate(async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/qna', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) return { ok: false };
      const data = await response.json();
      return { ok: true, questions: Array.isArray(data.questions) ? data.questions : [] };
    } finally { clearTimeout(timer); }
  });
  if (!result.ok) throw Error('공유 목록 조회 실패');
  return result.questions;
}
async function ownMutation(page, key, payload) {
  return page.evaluate(async ({ key, payload }) => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch('/api/qna', {
        method: 'POST', credentials: 'same-origin', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-QNA-Owner': key }, body: JSON.stringify(payload)
      });
      return response.ok;
    } finally { clearTimeout(timer); }
  }, { key, payload: { ...payload, requestId: randomUUID(), website: '' } });
}
async function cleanup() {
  if (!contextA) return;
  ownerA = ownerA || await readOwner(pageA).catch(() => null);
  ownerB = ownerB || await readOwner(pageB).catch(() => null);
  if (!ownerA && !questionId) return;
  let questions = await listQuestions(pageA);
  const targets = questions.filter(q => (q.id === questionId || q.title === title || q.title === editedTitle) && q.author === author);
  for (const candidate of targets) {
    // Remove only this run's answer, using its author's key. Never remove another participant's answer.
    for (const answer of candidate.answers || []) {
      const belongsToRun = answer.author === author && (answer.id === answerId || answer.body === answerBody || answer.body === editedAnswerBody);
      if (belongsToRun && ownerB) {
        const ok = await ownMutation(pageB, ownerB, { action: 'delete-answer', questionId: candidate.id, answerId: answer.id, expectedVersion: answer.version });
        assert(ok, '정리: 본인 임시 답변 API 삭제');
      }
    }
    questions = await listQuestions(pageA);
    const fresh = questions.find(q => q.id === candidate.id);
    if (!fresh) continue;
    if (fresh.answers?.length) { assert(false, '정리: 타인의 답변이 있어 질문을 보존함'); }
    if (!ownerA) { assert(false, '정리: 본인 수정 권한을 확인할 수 없음'); }
    const ok = await ownMutation(pageA, ownerA, { action: 'delete-question', questionId: fresh.id, expectedVersion: fresh.version });
    assert(ok, '정리: 본인 임시 질문 API 삭제');
  }
  questions = await listQuestions(pageA);
  assert(!questions.some(q => q.id === questionId || q.title === title || q.title === editedTitle), '정리: 이 실행의 임시 질문이 남지 않음');
}

(async () => {
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    async function context(label) {
      const value = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: 'ko-KR' });
      await value.route('**/*', async route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        externalRequests.push({ participant: label });
        return route.abort('blockedbyclient');
      });
      value.on('page', page => {
        page.on('pageerror', () => runtimeErrors.push({ participant: label }));
        page.on('console', message => {
          if (message.type() === 'error' && /content security|violates|refused to/i.test(message.text())) cspErrors.push({ participant: label });
        });
      });
      return value;
    }
    contextA = await context('A'); contextB = await context('B');
    pageA = await contextA.newPage(); pageB = await contextB.newPage();
    await stage('서로 다른 브라우저의 공유 목록 준비', async () => {
      const responses = await Promise.all([pageA.goto(base, { waitUntil: 'load' }), pageB.goto(base, { waitUntil: 'load' })]);
      await Promise.all([ready(pageA), ready(pageB)]);
      assert(responses.every(response => response.ok()), '두 브라우저에서 배포 페이지 정상 응답');
      assert(responses.every(response => response.headers()['content-security-policy']?.includes("script-src 'self'")), '두 브라우저에 엄격한 스크립트 CSP 적용');
      await Promise.all([openQna(pageA), openQna(pageB)]);
      assert(await pageA.locator('#qna-create').isEnabled() && await pageB.locator('#qna-create').isEnabled(), '실제 공유 API에 질문·답변 작성 가능');
    });
    await stage('참여자 A 질문 등록', async () => {
      await pageA.locator('#qna-create').click();
      await pageA.locator('#qna-question-title').fill(title);
      await pageA.locator('#qna-question-body').fill(questionBody);
      await pageA.locator('#qna-question-author').fill(author);
      await pageA.locator('#qna-question-tags').fill('QA, 자동검증');
      await pageA.locator('#qna-question-category').selectOption('기타');
      await pageA.locator('#qna-question-form [type="submit"]').click();
      await pageA.waitForFunction(value => document.querySelector('#qna-thread-dialog')?.open && document.querySelector('#qna-thread-title')?.textContent === value, title);
      questionId = new URLSearchParams(new URL(pageA.url()).hash.slice(1)).get('qna');
      ownerA = await readOwner(pageA);
      assert(validQuestionId(questionId) && !!ownerA, '질문이 공유 저장되고 작성자 권한을 보관함');
      assert(await pageA.locator('[data-qna-edit-question]').count() === 1, 'A에게 본인 질문 수정 기능 표시');
    });
    await stage('참여자 B 조회와 답변 등록', async () => {
      await refresh(pageB);
      await card(pageB).waitFor({ state: 'visible' });
      assert(await card(pageB).count() === 1, 'B 새로고침에서 A 질문 공유 확인');
      await openOwnQuestion(pageB);
      assert(await pageB.locator('[data-qna-edit-question],[data-qna-delete-question]').count() === 0, 'B에게 타인 질문 수정·삭제 버튼 없음');
      await pageB.locator('#qna-answer-body').fill(answerBody);
      await pageB.locator('#qna-answer-author').fill(author);
      await pageB.locator('#qna-answer-form [type="submit"]').click();
      await pageB.waitForFunction(value => [...document.querySelectorAll('.qna-answer-text')].some(n => n.textContent === value), answerBody);
      answerId = await pageB.locator('[data-qna-edit-answer]').getAttribute('data-qna-edit-answer');
      ownerB = await readOwner(pageB);
      assert(validAnswerId(answerId) && !!ownerB, 'B 답변이 공유 저장되고 작성자 권한을 보관함');
      assert(ownerA !== ownerB, '두 브라우저가 서로 다른 작성 권한을 사용함');
    });
    await stage('A 새로고침과 답변 본문 검색', async () => {
      await refresh(pageA);
      await search(pageA, answerToken);
      await card(pageA).waitFor({ state: 'visible' });
      assert(await card(pageA).count() === 1, 'A가 새로고침 후 B 답변 본문으로 질문 검색');
      assert((await card(pageA).locator('.qna-card-reason').innerText()).includes('답변 본문'), '답변 본문 일치 이유 표시');
      assert(!pageA.url().includes(answerToken), '답변 검색어가 URL에 기록되지 않음');
      await openOwnQuestion(pageA);
      assert(await pageA.locator('[data-qna-edit-answer],[data-qna-delete-answer]').count() === 0, 'A에게 B 답변 수정·삭제 버튼 없음');
    });
    await stage('본인 질문·답변 수정과 상대 브라우저 반영', async () => {
      await pageA.locator('[data-qna-edit-question]').click();
      await pageA.locator('#qna-question-title').fill(editedTitle);
      await pageA.locator('#qna-question-form [type="submit"]').click();
      await pageA.waitForFunction(value => !document.querySelector('#qna-compose-dialog')?.open && document.querySelector('#qna-thread-title')?.textContent === value, editedTitle);
      assert((await pageA.locator('#qna-thread-title').innerText()) === editedTitle, 'A 본인 질문 수정 저장');
      await refresh(pageB);
      await openOwnQuestion(pageB);
      assert((await pageB.locator('#qna-thread-title').innerText()) === editedTitle, 'B 새로고침에 수정된 질문 반영');
      assert(await pageB.locator('[data-qna-edit-question]').count() === 0, '수정 후에도 타인 질문 수정 버튼 없음');
      await pageB.locator('[data-qna-edit-answer]').click();
      await pageB.locator('#qna-edit-answer-body').fill(editedAnswerBody);
      await pageB.locator('[data-qna-form="update-answer"] [type="submit"]').click();
      await pageB.waitForFunction(value => [...document.querySelectorAll('.qna-answer-text')].some(n => n.textContent === value), editedAnswerBody);
      assert(await pageB.locator('[data-qna-edit-answer]').count() === 1, 'B 본인 답변 수정 저장');
      await refresh(pageA);
      await search(pageA, editedAnswerToken);
      await card(pageA).waitFor({ state: 'visible' });
      assert(await card(pageA).count() === 1, '수정된 답변으로 검색 가능');
      await search(pageA, answerToken);
      assert(await card(pageA).count() === 0, '이전 답변 검색 캐시가 제거됨');
    });
    await stage('즐겨찾기·최근 본 기능의 QnA 자동완성 회귀', async () => {
      await pageA.locator('[data-major=""]').click();
      for (const [tab, keyboard] of [['#tab-saved', false], ['#tab-recent', true]]) {
        await pageA.locator(tab).click();
        await pageA.locator('#search').fill(marker);
        await pageA.locator('#search-suggestions').waitFor({ state: 'visible' });
        const choice = pageA.locator('#search-suggestions [role="option"]').filter({ has: pageA.locator('small', { hasText: '상담사 QnA' }) }).first();
        await choice.waitFor({ state: 'visible' });
        if (keyboard) {
          const index = Number((await choice.getAttribute('id')).split('-').at(-1));
          for (let i = 0; i <= index; i++) await pageA.locator('#search').press('ArrowDown');
          await pageA.locator('#search').press('Enter');
        } else await choice.click();
        await pageA.locator('#qna-global-results [data-qna-question="' + questionId + '"]').waitFor({ state: 'visible' });
        assert(await pageA.locator('#tab-all').getAttribute('aria-selected') === 'true', (keyboard ? '최근 보기 키보드' : '즐겨찾기 클릭') + ' QnA 추천 선택 시 전체 범위 복구');
        assert(await pageA.locator('#qna-global-results [data-qna-question="' + questionId + '"]').count() === 1, '개인 범위에서 선택한 QnA 검색 결과 누락 없음 ' + (keyboard ? '키보드' : '클릭'));
      }
    });
    await stage('390·320px 반응형과 질문 창', async () => {
      for (const width of [390, 320]) {
        await pageA.setViewportSize({ width, height: 844 });
        await pageA.evaluate(() => document.fonts.ready);
        assert(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px 통합 검색 가로 넘침 없음');
        await openQna(pageA);
        await search(pageA, editedAnswerToken);
        await card(pageA).waitFor({ state: 'visible' });
        assert(await pageA.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), width + 'px QnA 목록 가로 넘침 없음');
        await openOwnQuestion(pageA);
        assert(await pageA.locator('#qna-thread-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), width + 'px 질문·답변 창 가로 넘침 없음');
        await closeThread(pageA);
        await pageA.locator('#qna-create').click();
        assert(await pageA.locator('#qna-compose-dialog').evaluate(n => n.scrollWidth <= n.clientWidth + 1), width + 'px 질문 작성 창 가로 넘침 없음');
        await pageA.locator('[data-qna-close-compose]').first().click();
      }
      assert(runtimeErrors.length === 0, '두 브라우저의 JavaScript 실행 오류 없음');
      assert(cspErrors.length === 0, '두 브라우저의 CSP 위반 없음');
      assert(externalRequests.length === 0, '외부 출처로 테스트 데이터 전송 없음');
    });
    await stage('UI로 본인 답변과 질문 삭제', async () => {
      await pageB.locator('[data-qna-delete-answer]').click();
      await pageB.locator('#qna-confirm-delete').click();
      await pageB.waitForFunction(() => !document.querySelector('#qna-confirm-dialog')?.open && !document.querySelector('.qna-answer-text'));
      assert(await pageB.locator('.qna-answer-text').count() === 0, 'B가 본인 답변 삭제');
      await refresh(pageA);
      await search(pageA, marker);
      await openOwnQuestion(pageA);
      await pageA.locator('[data-qna-delete-question]').click();
      await pageA.locator('#qna-confirm-delete').click();
      await pageA.waitForFunction(() => !document.querySelector('#qna-thread-dialog')?.open && !document.querySelector('#qna-confirm-dialog')?.open);
      assert(await card(pageA).count() === 0, '답변 삭제 후 A 본인 질문 삭제');
      await refresh(pageB);
      await search(pageB, marker);
      assert(await card(pageB).count() === 0, '상대 브라우저 새로고침에서도 임시 질문 삭제 확인');
    });
  } catch {
    // Playwright error text may include selectors containing authored text. Never persist it.
    if (!results.length || results.at(-1).pass) results.push({ name: currentStage + ' 실행', pass: false });
  } finally {
    try { await cleanup(); } catch { if (!results.length || results.at(-1).pass) results.push({ name: '본인 임시 자료 정리 완료', pass: false }); }
    if (browser) await browser.close();
    const report = { passed: results.filter(item => item.pass).length, failed: results.filter(item => !item.pass).length, results, runtimeErrorCount: runtimeErrors.length, cspErrorCount: cspErrors.length, externalRequestCount: externalRequests.length };
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify({ passed: report.passed, failed: report.failed, report: reportPath, failures: results.filter(item => !item.pass), runtimeErrorCount: report.runtimeErrorCount, cspErrorCount: report.cspErrorCount, externalRequestCount: report.externalRequestCount }, null, 2));
    if (report.failed) process.exitCode = 1;
  }
})();
