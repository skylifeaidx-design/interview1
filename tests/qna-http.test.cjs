const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { createQnaHandler } = require('../server/qna-http.cjs');
const { createQnaService, createMemoryStore } = require('../server/qna-service.cjs');
const ownerKey = crypto.randomBytes(32).toString('base64url');
const origin = 'https://interview1-chi.vercel.app';
const command = () => ({ action: 'create-question', requestId: crypto.randomUUID(), website: '',
  question: { title: '설치주소 변경은 어디서 하나요?', body: '메뉴를 찾고 있습니다.', category: '이용 변경', tags: ['이사'] } });
async function invoke(handler, { method = 'GET', headers = {}, body, chunks } = {}) {
  const req = chunks ? Readable.from(chunks) : {};
  req.method = method; req.headers = headers; if (!chunks) req.body = body;
  req.socket = { remoteAddress: '192.0.2.10' };
  const res = { headers: {}, statusCode: 200, setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
    end(value) { this.body = value; } };
  await handler(req, res);
  return { status: res.statusCode, headers: res.headers, data: JSON.parse(res.body), raw: res.body };
}
function connected(env = {}) { const store = createMemoryStore(); return { store,
  handler: createQnaHandler({ service: createQnaService({ store }), env }) }; }
const writeHeaders = (extra = {}) => ({ origin, 'content-type': 'application/json', 'x-qna-owner': ownerKey, ...extra });

test('공개 GET은 연결 상태와 공개 질문만 제공하고 캐시·CORS를 열지 않는다', async () => {
  const { handler } = connected(); const result = await invoke(handler);
  assert.equal(result.status, 200); assert.deepEqual(result.data, { configured: true, canWrite: true, questions: [] });
  assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['access-control-allow-origin'], undefined);
});

test('연결되지 않은 저장소는 성공이나 브라우저 저장으로 가장하지 않는다', async () => {
  const handler = createQnaHandler({ service: createQnaService(), env: {} });
  const result = await invoke(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.data, { configured: false, canWrite: false,
    error: { code: 'STORAGE_NOT_CONFIGURED', message: '공유 저장소 연결을 준비하고 있습니다.' }, questions: [] });
});

test('JSON POST 등록과 GET에 소유키·소유 해시·원 IP가 노출되지 않는다', async () => {
  const { handler } = connected(); const result = await invoke(handler, { method: 'POST', headers: writeHeaders(), body: command() });
  assert.equal(result.status, 200); assert(result.data.question.id.startsWith('q-'));
  const read = await invoke(handler); assert.equal(read.data.questions.length, 1);
  for (const value of [result.raw, read.raw]) { assert(!value.includes(ownerKey)); assert(!/ownerHash|192\.0\.2\.10|rateSalt|rates/.test(value)); }
});

test('외부 Origin·누락 Origin·위조 Host는 쓰기 권한을 만들지 못한다', async () => {
  const { handler, store } = connected();
  for (const headers of [writeHeaders({ origin: 'https://evil.test' }), writeHeaders({ origin: '' }),
    writeHeaders({ origin: 'https://evil.test', host: 'evil.test' })]) {
    const result = await invoke(handler, { method: 'POST', headers, body: command() });
    assert.equal(result.status, 403); assert.equal(result.data.error.code, 'ORIGIN_NOT_ALLOWED');
  }
  assert.equal(store.inspect(), null);
});

test('환경에서 지정한 배포 URL과 명시적인 로컬 Origin만 허용한다', async () => {
  const { handler } = connected({ VERCEL_URL: 'interview1-example.vercel.app', QNA_ALLOWED_ORIGINS: 'http://127.0.0.1:4180' });
  for (const value of ['https://interview1-example.vercel.app', 'http://127.0.0.1:4180'])
    assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders({ origin: value }), body: command() })).status, 200);
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders({ origin: 'http://localhost:4180' }), body: command() })).status, 403);
});

test('Preview는 연결되어도 기본 읽기 전용이다', async () => {
  const { handler, store } = connected({ VERCEL_ENV: 'preview' });
  const result = await invoke(handler); assert.equal(result.data.canWrite, false);
  const rejected = await invoke(handler, { method: 'POST', headers: writeHeaders(), body: command() });
  assert.equal(rejected.status, 403); assert.equal(rejected.data.error.code, 'READ_ONLY'); assert.equal(store.inspect(), null);
});

test('지원하지 않는 메서드·본문 형식·소유키·honeypot을 거부한다', async () => {
  const { handler } = connected();
  assert.equal((await invoke(handler, { method: 'DELETE' })).status, 405);
  assert.equal((await invoke(handler, { method: 'OPTIONS' })).status, 405);
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders({ 'content-type': 'text/plain' }), body: command() })).status, 415);
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders({ 'x-qna-owner': '' }), body: command() })).data.error.code, 'INVALID_OWNER_KEY');
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), body: { ...command(), website: 'spam' } })).data.error.code, 'SPAM_REJECTED');
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), body: '{bad json' })).data.error.code, 'INVALID_JSON');
});

test('32KiB 요청 제한은 파싱된 본문과 Content-Length 없는 스트림 모두에 적용한다', async () => {
  const { handler, store } = connected();
  const large = { ...command(), extra: 'x'.repeat(33 * 1024) };
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), body: large })).status, 413);
  const raw = Buffer.from(JSON.stringify(large));
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), chunks: [raw.subarray(0, 100), raw.subarray(100)] })).status, 413);
  assert.equal(store.inspect(), null);
});

test('HTTP 수정 충돌과 타인 수정은 각각 409·403으로 구분한다', async () => {
  const { handler } = connected();
  const first = await invoke(handler, { method: 'POST', headers: writeHeaders(), body: command() });
  const update = { action: 'update-question', questionId: first.data.question.id, expectedVersion: 1,
    question: { ...command().question, title: '수정된 제목' } };
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), body: update })).status, 200);
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders(), body: update })).status, 409);
  assert.equal((await invoke(handler, { method: 'POST', headers: writeHeaders({ 'x-qna-owner': crypto.randomBytes(32).toString('base64url') }), body: update })).status, 403);
});

test('예기치 않은 서버 예외의 내부 메시지나 인증정보를 응답하지 않는다', async () => {
  const service = { isConfigured: () => true, read: async () => { throw Error('secret-token-placeholder'); } };
  const result = await invoke(createQnaHandler({ service, env: {} }));
  assert.equal(result.status, 503); assert(!result.raw.includes('secret-token-placeholder'));
});
