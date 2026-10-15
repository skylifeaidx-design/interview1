'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const projectRoot = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(projectRoot, 'src/search.js'), 'utf8');
const moduleContext = { module: { exports: {} } };
vm.runInNewContext(source, moduleContext);
const { createEngine } = moduleContext.module.exports;
const dictionary = JSON.parse(fs.readFileSync(path.join(projectRoot, 'content/search-dictionary.json'), 'utf8'));
function readCatalog() {
  const loader = path.join(projectRoot, 'execution/catalog.cjs');
  if (fs.existsSync(loader)) return require(loader).loadCatalog(projectRoot);
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'content/catalog.json'), 'utf8'));
}
const catalog = readCatalog();
const engine = createEngine(catalog.features, dictionary);
const cases = [
  ['미납으로 휴대폰이 정지됐는데 돈 내고 풀려면', '이용정지 해제·납부'],
  ['돈 안 내서 티비가 끊겼어요 다시 보고 싶어요', '이용정지 해제·납부'],
  ['미납 정지 해제', '이용정지 해제·납부'],
  ['이용정지 해제·납부', '이용정지 해제·납부'],
  ['휴대폰 잃어버렸는데 잠깐 멈추고 싶어요', '모바일 일시정지/해제'],
  ['핸드폰 일시 정지 해제', '모바일 일시정지/해제'],
  ['모바일 분실 정지', '모바일 일시정지/해제'],
  ['미납은 아니고 휴대폰 잠시 정지하려고요', '모바일 일시정지/해제'],
  ['이번 달 요금 얼마 나왔어요?', '청구요금 조회'],
  ['지난달 요금을 확인하려는데요', '청구요금 조회'],
  ['청 구 요 금', '청구요금 조회'],
  ['청구서', '청구요금 조회'],
  ['실시간 요금이 궁금해요', '모바일 실시간 이용량/요금조회'],
  ['청구서 말고 지금까지 사용한 요금이 궁금해요', '모바일 실시간 이용량/요금조회'],
  ['핸드폰 데이터가 얼마나 남았나요', '모바일 실시간 이용량/요금조회'],
  ['모바일 데이터 잔여량', '모바일 실시간 이용량/요금조회'],
  ['이사해서 인터넷 설치 장소 바꾸려고요', '설치주소 변경 신청'],
  ['인터넷 해지 안 하고 이사 설치주소만 바꿀래요', '설치주소 변경 신청'],
  ['이전 설치 하고 싶어요', '설치주소 변경 신청'],
  ['이사 신청 내역', '설치주소 변경 신청 내역'],
  ['이전설치 일정 확인', '설치주소 변경 신청 내역'],
  ['회원 주소를 바꾸고 싶어요', '회원정보 수정'],
  ['이메일 변경', '회원정보 수정'],
  ['휴대폰 요금제 바꾸기', '모바일 요금제 예약·변경'],
  ['핸드폰 쓰는 요금제를 싼 걸로 바꾸고 싶어요', '모바일 요금제 예약·변경'],
  ['모바일 요금제 종류 비교', '모바일 요금제 안내'],
  ['인터넷 요금제 추천해주세요', '인터넷 요금제 안내'],
  ['티비 요금제 안내', 'TV 요금제 안내'],
  ['에이 에스 기사 불러주세요', 'A/S 신청'],
  ['A/S 접수하고 싶어요', 'A/S 신청'],
  ['AS 신청 내역', 'A/S 신청 내역'],
  ['기사 언제 오나요', 'A/S 신청 내역'],
  ['TV가 안 나와요 신호 없음이라고 떠요', 'A/S 자가진단'],
  ['이 심 개통', 'eSIM 개통'],
  ['e-sim 신청', 'eSIM 개통'],
  ['ESIM', 'eSIM 개통'],
  ['유 심 배송 신청', '유심 개통/신청'],
  ['USIM 번호 이동', '유심 개통/신청'],
  ['혼자 개통하려면', '셀프개통 안내'],
  ['납부 영수증 받고 싶어요', '요금 납부 이력 조회'],
  ['돈 냈는지 입금 확인', '요금 납부 이력 조회'],
  ['자동이체 카드 바꾸고 싶어요', '납부 방법 변경'],
  ['납부 방법은 뭐가 있나요', '요금 납부방법 안내'],
  ['비번 까먹었어요', '비밀번호 찾기·재설정'],
  ['아이디를 잊어버렸어요', '아이디 찾기'],
  ['카카오 로그인 방법', '회원 로그인'],
  ['내 인터넷 약정기간은 어디서 보나요', '인터넷 가입 정보'],
  ['모바일 사용 중인 부가서비스 내역 확인', '모바일 부가서비스 가입내역'],
  ['TV 부가서비스 해지', 'TV 부가서비스 가입내역'],
  ['TV 채널 번호 몇 번', 'TV 채널안내'],
  ['오늘 방송 편성표', 'TV 실시간 편성표'],
  ['리모콘 구매', '리모컨 구매'],
  ['모바일 쿠폰 등록', '모바일 쿠폰 등록'],
  ['일 대 일 문의', '1:1 문의'],
  ['문의 답변 확인', '1:1 문의 내역'],
  ['고객센터 전화번호', '고객센터 안내'],
  ['명의변경 서류', '필요서류 안내'],
  ['성인 채널 비밀번호', '자녀안심 설정 안내'],
  ['ㅊㄱㅇㄱ', '청구요금 조회'],
  ['ㄹㅁㅋ', '리모컨 구매'],
  ['쳥구요금', '청구요금 조회'],
  ['청구요굼', '청구요금 조회'],
  ['천구요금', '청구요금 조회'],
  ['이젼 설치', '설치주소 변경 신청'],
  ['사업자 청구요금', '사업자 청구요금 조회'],
  ['법인 미납요금', '사업자 미납요금 조회']
];
for (const [query, expected] of cases) test('상담 검색: ' + query, () => {
  const result = engine.search(query);
  assert.equal(result.items[0]?.feature.title, expected, JSON.stringify(result.items.slice(0, 3).map(x => [x.feature.title, x.score])));
  assert.equal(result.lowConfidence, false);
  assert.ok(result.items[0].reason.length > 3);
});
for (const query of ['티비 해지하려고요', '해지하고 싶어요', '인터넷 요금제를 바꾸고 싶어요', '티비 요금제를 낮추려고요', '인터넷 일시정지', '명의를 바꾸고 싶어요', '휴대폰 요금을 환불해 주세요', '전화번호 변경', '해지 위약금 조회']) test('미지원 직접 업무: ' + query, () => {
  const result = engine.search(query);
  assert.equal(result.items.length, 0);
  assert.equal(result.intent.unsupported, true);
  assert.equal(result.lowConfidence, true);
  assert.ok(result.suggestions.length > 0);
});
for (const query of ['양자컴퓨터암호화', 'gibberish99999', '<script>alert(123)</script>', '사은품 언제 와요']) test('무결과 정직성: ' + query, () => {
  const result = engine.search(query);
  assert.equal(result.total, 0);
  assert.equal(result.lowConfidence, true);
});
test('모호한 정지 해제는 업무를 확인하도록 안내한다', () => {
  const result = engine.search('정지 해제');
  assert.equal(result.lowConfidence, true);
  assert.equal(result.intent.ambiguous, true);
  assert.ok(result.suggestions.includes('모바일 일시정지 해제'));
});
test('모호한 주소변경은 설치와 회원정보를 구분한다', () => {
  const result = engine.search('주소 변경');
  assert.equal(result.lowConfidence, true);
  assert.equal(result.intent.ambiguous, true);
});
test('모든 실제 기능명은 본인 기능을 첫 결과로 반환한다', () => {
  for (const feature of catalog.features) assert.equal(engine.search(feature.title).items[0]?.feature.id, feature.id, feature.title);
});
test('검색·자동완성 결과는 원본 기능 목록을 벗어나지 않는다', () => {
  const ids = new Set(catalog.features.map(f => f.id));
  for (const [query] of cases) for (const item of engine.search(query).items) assert.ok(ids.has(item.feature.id));
});
test('대·중·소 분류 및 상품 필터는 정확히 적용된다', () => {
  const f = catalog.features.find(f => f.title === '모바일 요금제 예약·변경');
  const result = engine.search('', { major: f.major, middle: f.middle, minor: f.minor, product: f.product });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].feature.id, f.id);
});
test('로그인·공개·기능 유형·업무 필터 및 scope가 적용된다', () => {
  for (const item of engine.search('', { login: 'public' }).items) assert.equal(item.feature.login, false);
  for (const item of engine.search('', { login: 'required' }).items) assert.equal(item.feature.login, true);
  for (const item of engine.search('', { action: '변경' }).items) assert.equal(item.feature.action, '변경');
  const chosen = catalog.features[0];
  assert.equal(engine.search('', { scope: [chosen.id] }).total, 1);
  if (chosen.availability) for (const item of engine.search('', { availability: chosen.availability.mode }).items) assert.equal(item.feature.availability.mode, chosen.availability.mode);
});
test('필터가 결과를 모두 제외해도 검색어와 의도는 유지된다', () => {
  const result = engine.search('청구요금', { major: '존재하지않는분류' });
  assert.equal(result.total, 0);
  assert.equal(result.normalizedQuery, '청구요금');
  assert.equal(result.intent.id, 'bill');
});
test('사전 추가만으로 새 고객표현을 기존 기능에 연결한다', () => {
  const custom = JSON.parse(JSON.stringify(dictionary));
  custom.intents.find(i => i.id === 'relocation').phrases.push('보금자리를옮겼어요');
  const other = createEngine(catalog.features, custom);
  assert.equal(other.search('보금자리를 옮겼어요').items[0].feature.title, '설치주소 변경 신청');
});
test('한글 자모 차이를 통한 사전 밖 오타도 찾는다', () => {
  const result = engine.search('리모컨구매', {});
  assert.equal(result.items[0].feature.title, '리모컨 구매');
  const typo = engine.search('리모킨구매');
  assert.equal(typo.items[0].feature.title, '리모컨 구매');
  assert.equal(typo.items[0].matchType, 'typo');
  assert.ok(typo.correction);
});
test('요금재 오타는 상품 안내와 기존 요금제 변경을 함께 탐색한다', () => {
  const result = engine.search('요금재');
  assert.equal(result.normalizedQuery, '요금제');
  assert.ok(result.items.some(item => item.feature.title === '모바일 요금제 예약·변경'));
  assert.ok(result.items.some(item => item.feature.title === '모바일 요금제 안내'));
  assert.ok(result.items.some(item => item.feature.title === '인터넷 요금제 안내'));
  assert.ok(result.items.every(item => item.feature.title.includes('요금제')));
  assert.equal(result.intent.action, '');
  assert.equal(result.intent.product, '');
});
test('긴 상담 문장과 500자 초과 입력도 예외 없이 처리한다', () => {
  const query = '고객님께서 홈페이지에서 어떻게 안내해야 하는지 물어보셨는데 이번에 이사를 해서 인터넷 설치주소를 변경하려고 하십니다.';
  assert.equal(engine.search(query).items[0].feature.title, '설치주소 변경 신청');
  assert.doesNotThrow(() => engine.search('가'.repeat(10000)));
});
test('자동완성은 구조화된 문자열 제안이며 최대 일곱 개다', () => {
  for (const query of ['', '요금', 'ㅊㄱ', '미납', '티비 해지']) {
    const suggestions = engine.suggest(query);
    assert.ok(suggestions.length <= 7);
    for (const item of suggestions) assert.equal(typeof item.text, 'string');
  }
});
test('브라우저 전역 API도 Node UMD와 같은 결과를 낸다', () => {
  const browser = {};
  vm.runInNewContext(source, browser);
  assert.equal(typeof browser.GuideSearch.createEngine, 'function');
  assert.equal(browser.GuideSearch.createEngine(catalog.features, dictionary).search('이사').items[0].feature.title, '설치주소 변경 신청');
});
test('입력 원본을 수정하지 않고 검색문장·개인정보를 저장하거나 전송하지 않는다', () => {
  const before = JSON.stringify(catalog.features);
  engine.search('고객 전화번호 010-1234-5678 이사 문의');
  assert.equal(JSON.stringify(catalog.features), before);
  assert.equal(/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|console|sendBeacon)\s*[.(]/.test(source), false);
});
test('HTML·정규식 형태의 입력은 코드로 실행되지 않는다', () => {
  for (const query of ['<img src=x onerror=globalThis.PWNED=1>', '.*(a+)+$', '(?<evil>.*)+'.repeat(200)]) {
    assert.doesNotThrow(() => engine.search(query));
    assert.equal(globalThis.PWNED, undefined);
  }
});
