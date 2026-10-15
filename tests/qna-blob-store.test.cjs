const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createBlobStore, PATHNAME } = require('../server/qna-blob-store.cjs');
const { createQnaService, QnaStoreConflictError } = require('../server/qna-service.cjs');

const env = { BLOB_READ_WRITE_TOKEN: 'unit-test-server-secret-not-real' };
const code = value => error => error.code === value;
const reply = (value, etag = '"v1"') => ({ statusCode: 200, stream: new Response(JSON.stringify(value)).body,
  blob: { etag, size: Buffer.byteLength(JSON.stringify(value)) } });
function deferredStream(chunks) {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(Buffer.from(chunk)); },
    cancel() { cancelled = true; } });
  return { stream, wasCancelled: () => cancelled };
}

test('연결된 store ID만 있어도 요청별 OIDC 인증 판정을 SDK에 맡긴다', async () => {
  let loads = 0;
  const store = createBlobStore({ env: { BLOB_STORE_ID: 'store_unit-test-only' },
    loadSdk: async () => { loads++; return { get: async (pathname, options) => {
      assert.equal(pathname, PATHNAME);
      assert.deepEqual(options, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } });
      return null;
    } }; } });
  assert.equal(store.configured(), true);
  assert.equal(loads, 0);
  assert.equal(await store.read(), null);
  assert.equal(loads, 1);
});

test('Blob adapter는 private 원본 읽기와 ETag를 보존하고 인증정보를 SDK 인수에 노출하지 않는다', async () => {
  const calls = []; let loads = 0;
  const api = { get: async (...args) => { calls.push(args); return reply({ schemaVersion: 1 }, '"quoted-etag"'); } };
  const store = createBlobStore({ env, loadSdk: async () => { loads++; return api; } });
  assert.equal(store.configured(), true); assert.equal(loads, 0);
  const result = await store.read();
  assert.equal(result.etag, '"quoted-etag"'); assert.deepEqual(result.value, { schemaVersion: 1 });
  assert.deepEqual(calls, [[PATHNAME, { access: 'private', useCache: false, headers: { 'accept-encoding': 'identity' } }]]);
  assert.equal(loads, 1); assert(!JSON.stringify(calls).includes(env.BLOB_READ_WRITE_TOKEN));
});

test('최초 생성은 덮어쓰지 않고 갱신은 읽은 ETag로만 허용한다', async () => {
  const calls = [];
  const store = createBlobStore({ env, loadSdk: async () => ({ put: async (...args) => { calls.push(args); return { etag: '"v2"' }; } }) });
  assert.deepEqual(await store.write({ value: 1 }, { createOnly: true }), { etag: '"v2"' });
  await store.write({ value: 2 }, { ifMatch: '"v1"' });
  assert.equal(calls[0][0], PATHNAME); assert.equal(calls[0][2].access, 'private');
  assert.equal(calls[0][2].addRandomSuffix, false); assert.equal(calls[0][2].allowOverwrite, false);
  assert.equal(calls[0][2].ifMatch, undefined);
  assert.equal(calls[1][2].allowOverwrite, true); assert.equal(calls[1][2].ifMatch, '"v1"');
  await assert.rejects(store.write({ value: 3 }, {}));
  assert.equal(calls.length, 2);
});

test('압축 표현의 weak ETag는 원본 버전으로 간주하거나 임의로 보정하지 않는다', async () => {
  for (const etag of ['W/"compressed"', '']) {
    const held = deferredStream(['{}']);
    const store = createBlobStore({ env, loadSdk: async () => ({ get: async () => ({
      statusCode: 200, stream: held.stream, blob: { size: 2, etag },
    }) }) });
    await assert.rejects(store.read(), code('STORAGE_ETAG_INVALID'));
    assert.equal(held.wasCancelled(), true);
  }
});

test('미설정 어댑터의 읽기·쓰기 모두 SDK 로드와 네트워크 호출 이전에 실패한다', async () => {
  let loaded = false;
  const store = createBlobStore({ env: {}, loadSdk: () => { loaded = true; throw Error('로드 금지'); } });
  assert.equal(store.configured(), false);
  await assert.rejects(store.read(), code('STORAGE_NOT_CONFIGURED'));
  await assert.rejects(store.write({}, { createOnly: true }), code('STORAGE_NOT_CONFIGURED'));
  assert.equal(loaded, false);
});

test('SDK의 ETag 412 충돌과 최초 생성 충돌을 CAS 재시도 신호로 변환한다', async () => {
  class BlobPreconditionFailedError extends Error {}
  for (const error of [new BlobPreconditionFailedError('ETag mismatch'), Object.assign(new Error('mismatch'), { status: 412 })]) {
    const store = createBlobStore({ env, loadSdk: async () => ({ BlobPreconditionFailedError, put: async () => { throw error; } }) });
    await assert.rejects(store.write({}, { ifMatch: '"old"' }), QnaStoreConflictError);
  }
  const existing = createBlobStore({ env, loadSdk: async () => ({ put: async () => { throw Error('Vercel Blob: This blob already exists. Use allowOverwrite: true.'); } }) });
  await assert.rejects(existing.write({}, { createOnly: true }), QnaStoreConflictError);
});

test('실제 Blob 호출 형태의 최초 생성 경쟁도 최신 상태 재조회로 두 질문을 보존한다', async () => {
  let value = null, version = 0, createCollisions = 0;
  const api = {
    get: async () => value ? reply(value, String(version)) : null,
    put: async (pathname, body, options) => {
      assert.equal(pathname, PATHNAME);
      if (!options.allowOverwrite && value) { createCollisions++; throw Error('This blob already exists.'); }
      if (options.allowOverwrite && options.ifMatch !== String(version)) { const error = Error('mismatch'); error.status = 412; throw error; }
      value = JSON.parse(body); version++; return { etag: String(version) };
    },
  };
  const services = Array.from({ length: 2 }, () => createQnaService({ store: createBlobStore({ env, loadSdk: async () => api }) }));
  await Promise.all(services.map((service, index) => service.mutate({ action: 'create-question', requestId: crypto.randomUUID(),
    question: { title: '동시 등록 ' + index, body: '개별 질문' } }, { ownerKey: crypto.randomBytes(32).toString('base64url'), ip: '192.0.2.1' })));
  assert.equal(value.questions.length, 2); assert.equal(createCollisions, 1);
});

test('메타데이터 용량과 비정상 응답 상태를 거부할 때 열린 스트림을 취소한다', async () => {
  for (const details of [{ statusCode: 200, size: 129 }, { statusCode: 304, size: 1 }]) {
    const held = deferredStream(['{"value":true}']);
    const store = createBlobStore({ env, maximumBytes: 128, loadSdk: async () => ({ get: async () => ({
      statusCode: details.statusCode, stream: held.stream, blob: { size: details.size, etag: 'v1' },
    }) }) });
    await assert.rejects(store.read()); assert.equal(held.wasCancelled(), true);
  }
});

test('알 수 없는 길이의 응답도 누적 바이트 상한에서 읽기를 중단한다', async () => {
  const held = deferredStream(['{"text":"', '가'.repeat(50), '"}']);
  const store = createBlobStore({ env, maximumBytes: 64, loadSdk: async () => ({ get: async () => ({
    statusCode: 200, stream: held.stream, blob: { size: null, etag: 'v1' },
  }) }) });
  await assert.rejects(store.read(), code('STORAGE_SIZE_LIMIT')); assert.equal(held.wasCancelled(), true);
});

test('쓰기 상한은 한글 문자열의 글자 수가 아닌 UTF-8 바이트로 검사한다', async () => {
  let calls = 0;
  const store = createBlobStore({ env, maximumBytes: 64, loadSdk: async () => ({ put: async () => { calls++; return { etag: 'v1' }; } }) });
  await assert.rejects(store.write({ text: '가'.repeat(30) }, { createOnly: true }), code('STORAGE_SIZE_LIMIT'));
  assert.equal(calls, 0);
});

test('SDK 예외 메시지의 서버 인증정보가 서비스 오류 응답으로 전파되지 않는다', async () => {
  for (const stage of ['read', 'write']) {
    const api = { get: async () => { if (stage === 'read') throw Error(env.BLOB_READ_WRITE_TOKEN); return null; },
      put: async () => { throw Error(env.BLOB_READ_WRITE_TOKEN); } };
    const service = createQnaService({ store: createBlobStore({ env, loadSdk: async () => api }) });
    const operation = stage === 'read' ? service.read() : service.mutate({ action: 'create-question', requestId: crypto.randomUUID(),
      question: { title: '질문', body: '내용' } }, { ownerKey: crypto.randomBytes(32).toString('base64url') });
    await assert.rejects(operation, error => error.code === 'STORAGE_UNAVAILABLE' && !error.message.includes(env.BLOB_READ_WRITE_TOKEN));
  }
});
