'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { search, normalize } = require('../src/qna-search.js');
const dictionary = JSON.parse(fs.readFileSync(path.join(root, 'content/search-dictionary.json'), 'utf8'));
function question(id, title, body = '', extra = {}) {
  return { id: 'q-' + id, title, body, category: '상담 사례', tags: [], author: '테스트 작성자', createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', version: 1, answers: [], ...extra };
}
const questions = [
  question('relocation', '이전설치 신청 전 확인할 사항', '설치주소 변경 신청 화면에서 제공되는 일정을 확인했습니다.', { tags: ['이사', '인터넷'], updatedAt: '2026-10-15T03:00:00Z' }),
  question('payment', '미납요금 납부 문의', '고객센터로 접수한 문의를 공유합니다.', { category: '요금·납부', tags: ['요금'], answers: [{ id: 'a-pay', body: '가상계좌 입금 확인에 대한 참여자 답변입니다.', author: '답변 작성자' }] }),
  question('pause', '휴대폰 일시정지 안내 경험', '분실한 회선에 대한 안내 경험을 작성했습니다.', { tags: ['모바일', '분실'] }),
  question('esim', 'eSIM 개통 오류 질문', 'QR코드를 확인한 사례입니다.', { tags: ['이심', '개통'] }),
  question('remote', '리모컨 구매 문의', '리모컨을 잃어버린 고객 문의입니다.', { tags: ['TV'] }),
  question('refund', '인터넷 해지와 환불에 대한 질문', '정답을 확정하지 않고 문의를 남깁니다.', { answers: [{ id: 'a-refund', body: '확인이 필요하며 이 글은 참여자 작성 답변입니다.' }] }),
  question('unused', '보도자료 관련 안내', '홈페이지 공지 내용입니다.', { updatedAt: '2026-10-15T05:00:00Z' })
];
test('제목 정확 일치와 핵심 단어로 질문을 찾는다', () => {
  assert.equal(search(questions, '리모컨 구매 문의', dictionary)[0].question.id, 'q-remote');
  assert.equal(search(questions, '이전설치를 어디서 신청하나요', dictionary)[0].question.id, 'q-relocation');
});
test('답변 본문만의 고유 표현으로 질문을 찾는다', () => {
  const result = search(questions, '가상계좌 입금 확인', dictionary);
  assert.equal(result[0].question.id, 'q-payment');
  assert.match(result[0].reason, /답변 본문/);
  assert.ok(result[0].matchedTerms.length);
});
test('태그와 분류도 검색한다', () => {
  assert.equal(search(questions, '이사', dictionary)[0].question.id, 'q-relocation');
  assert.equal(search(questions, '요금 납부', dictionary)[0].question.id, 'q-payment');
  assert.match(search([question('category', '일반 질문', '', { category: '접근성' })], '접근성', dictionary)[0].reason, /분류/);
});
test('같은 표현이 있을 때 제목과 태그를 답변보다 먼저 보여준다', () => {
  const data = [question('answer', '다른 문의', '', { answers: [{ body: '자동이체' }] }), question('tag', '태그에 등록한 문의', '', { tags: ['자동이체'] }), question('title', '자동이체')];
  const result = search(data, '자동이체', dictionary);
  assert.deepEqual(result.map(item => item.question.id), ['q-title', 'q-tag', 'q-answer']);
});
test('기존 홈페이지 검색과 같은 표기 정규화를 사용한다', () => {
  assert.equal(normalize('핸드폰 A/S 이심 리모콘 요금재', dictionary), '모바일asesim리모컨요금제');
  assert.equal(search(questions, '모바일 일시정지', dictionary)[0].question.id, 'q-pause');
  assert.equal(search(questions, '이 심 개통', dictionary)[0].question.id, 'q-esim');
});
test('사전의 고객 표현으로 실제 작성된 관련 문구를 찾는다', () => {
  const data = [question('move', '설치주소 변경 신청을 확인해주세요'), question('other', '관계없는 질문')];
  const result = search(data, '새집으로 이사를 가요', dictionary);
  assert.equal(result[0].question.id, 'q-move');
  assert.match(result[0].reason, /관련 표현/);
});
test('초성 검색으로 제목과 답변을 찾는다', () => {
  assert.equal(search(questions, 'ㄹㅁㅋ', dictionary)[0].question.id, 'q-remote');
  const result = search([question('a', '일반 질문', '', { answers: [{ body: '이전설치' }] })], 'ㅇㅈㅅㅊ', dictionary);
  assert.equal(result[0].question.id, 'q-a');
  assert.match(result[0].reason, /답변 본문.*초성/);
});
test('한글 자모 오타와 표기 오타를 허용한다', () => {
  const data = [question('r', '리모컨 구매'), question('b', '다른 질문')];
  assert.equal(search(data, '리모킨', dictionary)[0].question.id, 'q-r');
  assert.equal(search(data, '리모콘 구매', dictionary)[0].question.id, 'q-r');
});
test('무관한 문장은 결과를 만들지 않는다', () => {
  assert.deepEqual(search(questions, '양자컴퓨터암호화', dictionary), []);
  assert.deepEqual(search(questions, '우주선99999', dictionary), []);
  assert.deepEqual(search(questions, '사은품 언제 와요', dictionary), []);
});
test('홈페이지 직접 처리 미지원 업무라도 실제 작성된 QnA는 찾는다', () => {
  assert.equal(search(questions, '인터넷 해지 환불', dictionary)[0].question.id, 'q-refund');
});
test('답변을 만들거나 작성자를 검색해 결과를 만들지 않는다', () => {
  assert.deepEqual(search(questions, '숨겨진작업답변', dictionary), []);
  assert.deepEqual(search(questions, '테스트 작성자', dictionary), []);
  assert.ok(search(questions, '환불', dictionary).every(item => questions.includes(item.question)));
});
test('빈 검색은 최신 수정순이며 원본 배열과 객체를 유지한다', () => {
  const before = JSON.stringify(questions);
  const result = search(questions, '', dictionary);
  assert.equal(result[0].question.id, 'q-unused');
  assert.equal(result[1].question.id, 'q-relocation');
  assert.equal(JSON.stringify(questions), before);
  for (const item of result) assert.ok(questions.includes(item.question));
});
test('입력 HTML·정규식은 코드로 실행되지 않고 원본은 변하지 않는다', () => {
  const before = JSON.stringify(questions);
  const payloads = ['<img src=x onerror=globalThis.QNA_PWNED=1>', '.*(a+)+$', '('.repeat(10000)];
  for (const payload of payloads) assert.doesNotThrow(() => search(questions, payload, dictionary));
  assert.equal(globalThis.QNA_PWNED, undefined);
  assert.equal(JSON.stringify(questions), before);
});
test('500자를 초과하는 검색어는 동일한 앞부분 500자와 결과가 같다', () => {
  const text = '우주선'.repeat(200);
  assert.deepEqual(search(questions, text + '리모컨', dictionary), search(questions, text.slice(0, 500), dictionary));
});
test('두 번째 답변의 500자 뒤 본문도 검색하고 수정 내용이 즉시 반영된다', () => {
  const data = [question('edited', '공유 질문', '', { answers: [{ body: '첫 번째 답변' }, { body: '일반 문장 '.repeat(150) + '고유안내표현' }] })];
  assert.equal(search(data, '고유안내표현', dictionary)[0].question.id, 'q-edited');
  data[0].answers[1].body = '변경된고유문구';
  assert.deepEqual(search(data, '고유안내표현', dictionary), []);
  assert.equal(search(data, '변경된고유문구', dictionary)[0].question.id, 'q-edited');
});
test('외부 요청·저장·검색 로그 없이 브라우저 UMD로 실행된다', () => {
  const source = fs.readFileSync(path.join(root, 'src/qna-search.js'), 'utf8');
  assert.equal(/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|console|sendBeacon)\s*[.(]/.test(source), false);
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/search.js'), 'utf8'), browser);
  vm.runInNewContext(source, browser);
  assert.equal(browser.GuideQnASearch.search(questions, '리모컨 구매', dictionary)[0].question.id, 'q-remote');
});
test('사전이나 공유검색 의존성이 없어도 기본 텍스트 검색은 가능하다', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/qna-search.js'), 'utf8'), browser);
  assert.equal(browser.GuideQnASearch.search(questions, '리모컨')[0].question.id, 'q-remote');
  assert.deepEqual(search(null, '질문', dictionary), []);
});
