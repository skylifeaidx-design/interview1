const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createQnaService, createMemoryStore, QnaStoreConflictError } = require('../server/qna-service.cjs');
const { createBlobStore, PATHNAME } = require('../server/qna-blob-store.cjs');

const owner = () => crypto.randomBytes(32).toString('base64url');
const requestId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const question = (n = 1, fields = {}) => ({ action: 'create-question', requestId: requestId(n), website: '',
  question: { title: '홈페이지에서 청구요금을 확인하려면?', body: '메뉴 위치를 알려주세요.', category: '요금', tags: ['청구요금'], author: '상담사', ...fields } });
const context = key => ({ ownerKey: key, ip: '192.0.2.10' });
function setup(limits = {}) { const store = createMemoryStore(); return { store, service: createQnaService({ store, limits, now: () => 1_800_000_000_000 }) }; }
const code = expected => error => error.code === expected;

test('질문·답변 등록과 공개 응답은 저장소 비밀정보를 포함하지 않는다', async () => {
  const { service, store } = setup(), key = owner(), another = owner();
  const created = await service.mutate(question(), context(key));
  assert.equal(created.question.id, 'q-' + requestId(1));
  const answered = await service.mutate({ action: 'create-answer', questionId: created.question.id,
    requestId: requestId(2), answer: { body: '마이 > 요금 > 청구요금 조회를 확인해주세요.' } }, context(another));
  assert.equal(answered.question.answers[0].author, '익명 참여자');
  assert.equal(answered.question.answers[0].version, 1);
  assert.equal(answered.createdAnswerId, answered.question.answers[0].id);
  const result = await service.read();
  assert.equal(result.questions.length, 1);
  assert(!/ownerHash|rateSalt|rates|audit/.test(JSON.stringify(result)));
  assert(!JSON.stringify(result).includes(key));
  const snapshot = store.inspect();
  assert.equal(snapshot.questions[0].ownerHash.length, 64);
  assert(!JSON.stringify(snapshot).includes('192.0.2.10'));
  assert(!JSON.stringify(snapshot).includes(key));
});

test('질문과 답변은 각각의 작성 브라우저만 수정·삭제할 수 있다', async () => {
  const { service } = setup(), key = owner(), answerKey = owner(), stranger = owner();
  const { question: q } = await service.mutate(question(), context(key));
  await assert.rejects(service.mutate({ action: 'update-question', questionId: q.id, expectedVersion: 1,
    question: question(1).question }, context(stranger)), code('NOT_OWNER'));
  const answered = await service.mutate({ action: 'create-answer', questionId: q.id, requestId: requestId(2),
    answer: { body: '처음 답변' } }, context(answerKey));
  const a = answered.question.answers[0];
  await assert.rejects(service.mutate({ action: 'update-answer', questionId: q.id, answerId: a.id,
    expectedVersion: 1, answer: { body: '타인의 수정' } }, context(key)), code('NOT_OWNER'));
  await assert.rejects(service.mutate({ action: 'delete-answer', questionId: q.id, answerId: a.id,
    expectedVersion: 1 }, context(stranger)), code('NOT_OWNER'));
  const updated = await service.mutate({ action: 'update-answer', questionId: q.id, answerId: a.id,
    expectedVersion: 1, answer: { body: '작성자가 수정한 답변', author: '답변 작성자' } }, context(answerKey));
  assert.equal(updated.question.answers[0].body, '작성자가 수정한 답변');
  assert.equal(updated.question.answers[0].version, 2);
  await assert.rejects(service.mutate({ action: 'update-answer', questionId: q.id, answerId: a.id,
    expectedVersion: 1, answer: { body: '오래된 원고' } }, context(answerKey)), code('VERSION_CONFLICT'));
  await assert.rejects(service.mutate({ action: 'delete-question', questionId: q.id, expectedVersion: 1 }, context(key)), code('QUESTION_HAS_ANSWERS'));
});

test('질문 버전 충돌은 기존 내용을 덮어쓰지 않는다', async () => {
  const { service } = setup(), key = owner();
  const { question: q } = await service.mutate(question(), context(key));
  const edit = title => ({ action: 'update-question', questionId: q.id, expectedVersion: 1, question: { ...question().question, title } });
  const result = await service.mutate(edit('먼저 저장한 제목'), context(key));
  assert.equal(result.question.version, 2);
  await assert.rejects(service.mutate(edit('오래된 제목'), context(key)), code('VERSION_CONFLICT'));
  assert.equal((await service.read()).questions[0].title, '먼저 저장한 제목');
});

test('삭제한 질문·답변은 제한된 비공개 감사 이력만 남긴다', async () => {
  const { service, store } = setup({ audit: 2 }), key = owner();
  const { question: q } = await service.mutate(question(), context(key));
  const answered = await service.mutate({ action: 'create-answer', questionId: q.id, requestId: requestId(2), answer: { body: '삭제할 답변 원문' } }, context(key));
  await service.mutate({ action: 'delete-answer', questionId: q.id, answerId: answered.question.answers[0].id, expectedVersion: 1 }, context(key));
  const removed = await service.mutate({ action: 'delete-question', questionId: q.id, expectedVersion: 1 }, context(key));
  assert.equal(removed.question, null); assert.equal(removed.deletedQuestionId, q.id);
  assert.deepEqual((await service.read()).questions, []);
  assert.equal(store.inspect().audit.length, 2);
  assert(store.inspect().audit.some(event => event.record.body === '삭제할 답변 원문'));
  await assert.rejects(service.mutate(question(), context(key)), code('ENTRY_DELETED'));
  const { question: next } = await service.mutate(question(3), context(key));
  await service.mutate({ action: 'delete-question', questionId: next.id, expectedVersion: 1 }, context(key));
  assert.equal(store.inspect().audit.length, 2);
});

test('같은 등록 요청을 재전송해도 질문과 답변이 중복 생성되지 않는다', async () => {
  const { service, store } = setup(), key = owner();
  const first = await service.mutate(question(), context(key));
  const replay = await service.mutate(question(), context(key));
  assert.deepEqual(first, replay); assert.equal(store.inspect().questions.length, 1);
  const command = { action: 'create-answer', questionId: first.question.id, requestId: requestId(2), answer: { body: '답변' } };
  await service.mutate(command, context(key)); await service.mutate(command, context(key));
  assert.equal((await service.read()).questions[0].answers.length, 1);
  assert.equal(store.inspect().rates.find(rate => rate.kind === 'owner').count, 2);
  await assert.rejects(service.mutate(question(), context(owner())), code('NOT_OWNER'));
});

test('서로 다른 동시 등록이 CAS 재시도 후 모두 보존된다', async () => {
  const { service } = setup(), key = owner();
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => service.mutate(question(i + 1), context(key))));
  assert.equal(results.length, 5); assert.equal((await service.read()).questions.length, 5);
});

test('같은 질문의 동시 수정은 하나만 반영되고 나머지는 버전 충돌로 남는다', async () => {
  const { service } = setup(), key = owner(); const { question: q } = await service.mutate(question(), context(key));
  const results = await Promise.allSettled(['첫 수정', '다른 수정'].map(title => service.mutate({ action: 'update-question',
    questionId: q.id, expectedVersion: 1, question: { ...question().question, title } }, context(key))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
});

test('CAS 경쟁이 계속되면 저장 성공으로 표시하지 않는다', async () => {
  const store = createMemoryStore({ beforeWrite: () => { throw new QnaStoreConflictError(); } });
  const service = createQnaService({ store, limits: { retries: 2 } });
  await assert.rejects(service.mutate(question(), context(owner())), code('WRITE_CONFLICT'));
  assert.equal(store.inspect(), null);
});

test('필드 상한·제어문자·명백한 개인정보를 차단하고 일반 고객센터 안내는 허용한다', async () => {
  const { service } = setup(), key = owner();
  for (const fields of [{ title: '가'.repeat(121) }, { body: '가'.repeat(4001) }, { tags: Array(9).fill('요금') },
    { author: '가'.repeat(31) }, { author: 0 }, { body: '문자\u0000제어' }, { title: '제목\n변경' }]) {
    await assert.rejects(service.mutate(question(1, fields), context(key)), code('INVALID_INPUT'));
  }
  for (const body of ['010-1234-5678로 연락주세요', '주민등록번호 900101-1234567'])
    await assert.rejects(service.mutate(question(1, { body }), context(key)), code('PERSONAL_INFORMATION'));
  const allowed = await service.mutate(question(1, { body: '고객센터 1588-3002에 문의하세요. 010 번호의 본인인증 절차가 궁금합니다.' }), context(key));
  assert(allowed.question.body.includes('1588-3002'));
});

test('허용 필드만 저장하고 HTML처럼 보이는 일반 문자열은 실행 코드로 취급하지 않는다', async () => {
  const { service, store } = setup(), key = owner();
  const result = await service.mutate(question(1, { body: '<img src=x onerror=alert(1)>', ownerHash: 'forged', isAdmin: true }), context(key));
  assert.equal(result.question.body, '<img src=x onerror=alert(1)>');
  assert.equal(store.inspect().questions[0].isAdmin, undefined);
  assert.notEqual(store.inspect().questions[0].ownerHash, 'forged');
  await assert.rejects(service.mutate({ ...question(2), website: 'https://spam.test' }, context(key)), code('SPAM_REJECTED'));
});

test('질문 수·답변 수·전체 직렬화 용량 상한을 저장 전에 검사한다', async () => {
  const { service } = setup({ questions: 1, answers: 1 }), key = owner();
  const { question: q } = await service.mutate(question(), context(key));
  await assert.rejects(service.mutate(question(2), context(key)), code('QUESTION_LIMIT'));
  await service.mutate({ action: 'create-answer', questionId: q.id, requestId: requestId(2), answer: { body: '답변' } }, context(key));
  await assert.rejects(service.mutate({ action: 'create-answer', questionId: q.id, requestId: requestId(3), answer: { body: '추가 답변' } }, context(key)), code('ANSWER_LIMIT'));
  const small = setup({ snapshotBytes: 400 });
  await assert.rejects(small.service.mutate(question(), context(key)), code('STORAGE_SIZE_LIMIT'));
  assert.equal(small.store.inspect(), null);
});

test('소유키·IP·전역 한도는 같은 공유 CAS 문서에서 검사하고 다음 창에서 정리한다', async () => {
  const key = owner(), other = owner(); let timestamp = 1_800_000_000_000;
  const store = createMemoryStore(), service = createQnaService({ store, now: () => timestamp,
    limits: { ownerWrites: 1, ipWrites: 2, globalWrites: 3 } });
  await service.mutate(question(1), context(key));
  await assert.rejects(service.mutate(question(2), context(key)), code('RATE_LIMITED'));
  await service.mutate(question(2), context(other));
  await assert.rejects(service.mutate(question(3), context(owner())), code('RATE_LIMITED'));
  await service.mutate(question(3), { ownerKey: owner(), ip: '192.0.2.20' });
  await assert.rejects(service.mutate(question(4), { ownerKey: owner(), ip: '192.0.2.30' }), code('RATE_LIMITED'));
  timestamp += 60 * 60 * 1000;
  await service.mutate(question(4), context(key));
  assert.equal(store.inspect().rates.length, 3);
});

test('미연결은 명시적으로 실패하고 SDK를 로드하지 않는다', async () => {
  let loads = 0;
  const service = createQnaService({ store: createBlobStore({ env: {}, loadSdk: () => { loads++; throw Error('호출되면 안 됨'); } }) });
  assert.equal(service.isConfigured(), false);
  await assert.rejects(service.read(), code('STORAGE_NOT_CONFIGURED'));
  await assert.rejects(service.mutate(question(), context(owner())), code('STORAGE_NOT_CONFIGURED'));
  assert.equal(loads, 0);
});

test('Blob adapter는 고정 private 파일을 캐시 없이 읽고 생성·갱신 조건을 전달한다', async () => {
  const calls = []; const value = { test: true };
  const api = { get: async (...args) => { calls.push(['get', ...args]); return { statusCode: 200,
    stream: new Response(JSON.stringify(value)).body, blob: { etag: 'v1', size: 13 } }; },
  put: async (...args) => { calls.push(['put', ...args]); return { etag: 'v2' }; } };
  const store = createBlobStore({ env: { BLOB_READ_WRITE_TOKEN: 'test-placeholder' }, loadSdk: async () => api });
  assert.deepEqual(await store.read(), { value, etag: 'v1' });
  await store.write(value, { createOnly: true }); await store.write(value, { ifMatch: 'v1' });
  assert.equal(calls[0][1], PATHNAME); assert.deepEqual(calls[0][2], { access: 'private', useCache: false });
  assert.equal(calls[1][3].allowOverwrite, false); assert.equal(calls[1][3].ifMatch, undefined);
  assert.equal(calls[2][3].ifMatch, 'v1'); assert.equal(calls[2][3].allowOverwrite, true);
  assert(!JSON.stringify(calls).includes('test-placeholder'));
});
