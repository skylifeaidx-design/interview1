const { QnaError, QnaStoreConflictError, DEFAULT_LIMITS } = require('./qna-service.cjs');

const PATHNAME = 'qna/state.json';
function createBlobStore({ env = process.env, loadSdk = () => import('@vercel/blob'), maximumBytes = DEFAULT_LIMITS.snapshotBytes } = {}) {
  let sdkPromise;
  const sdk = () => (sdkPromise ||= Promise.resolve().then(loadSdk));
  const configured = () => Boolean((env.BLOB_STORE_ID && env.VERCEL_OIDC_TOKEN) || env.BLOB_READ_WRITE_TOKEN);
  function assertConfigured() {
    if (!configured()) throw new QnaError(503, 'STORAGE_NOT_CONFIGURED', '공유 저장소 연결을 준비하고 있습니다.');
  }
  async function cancel(stream) { try { await stream?.cancel(); } catch {} }
  async function readText(stream) {
    const reader = stream.getReader(); const chunks = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        total += value.byteLength;
        if (total > maximumBytes) { await reader.cancel(); throw new QnaError(503, 'STORAGE_SIZE_LIMIT', '공유 저장 내용의 크기를 확인하고 있습니다.'); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks, total).toString('utf8');
  }
  return {
    configured,
    async read() {
      assertConfigured();
      const api = await sdk();
      const result = await api.get(PATHNAME, { access: 'private', useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200 || !result.stream) { await cancel(result.stream); throw new Error('공유 파일을 읽을 수 없습니다.'); }
      if (result.blob.size > maximumBytes) { await cancel(result.stream); throw new QnaError(503, 'STORAGE_SIZE_LIMIT', '공유 저장 내용의 크기를 확인하고 있습니다.'); }
      return { value: JSON.parse(await readText(result.stream)), etag: result.blob.etag };
    },
    async write(value, { ifMatch, createOnly = false } = {}) {
      assertConfigured();
      if (!createOnly && (typeof ifMatch !== 'string' || !ifMatch)) throw new Error('갱신에는 공유 파일 버전이 필요합니다.');
      const api = await sdk(), body = JSON.stringify(value);
      if (Buffer.byteLength(body, 'utf8') > maximumBytes) throw new QnaError(413, 'STORAGE_SIZE_LIMIT', '공유 저장 공간이 가득 찼습니다.');
      try {
        const result = await api.put(PATHNAME, body, { access: 'private', addRandomSuffix: false,
          allowOverwrite: !createOnly, ...(createOnly ? {} : { ifMatch }), contentType: 'application/json', cacheControlMaxAge: 60 });
        return { etag: result.etag };
      } catch (error) {
        if ((api.BlobPreconditionFailedError && error instanceof api.BlobPreconditionFailedError)
          || error.name === 'BlobPreconditionFailedError' || error.status === 412 || error.statusCode === 412
          || (createOnly && /already exists|already been uploaded/i.test(error.message || ''))) throw new QnaStoreConflictError();
        throw error;
      }
    },
  };
}
module.exports = { createBlobStore, PATHNAME };
