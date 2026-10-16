const net = require('node:net');
const { QnaError } = require('./qna-service.cjs');
const { createBlobStore } = require('./qna-blob-store.cjs');
const { createPublishedQnaService } = require('./qna-publication.cjs');

const BODY_BYTES = 32 * 1024;
function origins(env) {
  const allowed = new Set(['https://interview1-chi.vercel.app']);
  if (env.VERCEL_URL) {
    try { const url = new URL('https://' + env.VERCEL_URL.replace(/^https:\/\//, '')); if (!url.username && !url.password) allowed.add(url.origin); } catch {}
  }
  for (const entry of String(env.QNA_ALLOWED_ORIGINS || '').split(/[\s,]+/).filter(Boolean)) {
    try {
      const url = new URL(entry);
      if (!url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) allowed.add(url.origin);
    } catch {}
  }
  return allowed;
}
function header(req, key) { const value = req.headers?.[key]; return typeof value === 'string' ? value : ''; }
function requestIP(req) {
  const candidates = [header(req, 'x-vercel-forwarded-for'), header(req, 'x-forwarded-for'), req.socket?.remoteAddress];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const value = candidate.split(',')[0].trim(); if (net.isIP(value)) return value;
  }
  return 'unknown';
}
async function body(req, maximum) {
  const length = header(req, 'content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new QnaError(413, 'BODY_TOO_LARGE', '요청 내용은 32KiB 이내로 작성해주세요.');
  let raw;
  if (req.body !== undefined) {
    try { raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? req.body : JSON.stringify(req.body); }
    catch { throw new QnaError(400, 'INVALID_JSON', '요청 내용을 확인해주세요.'); }
  } else {
    raw = await new Promise((resolve, reject) => {
      const chunks = []; let total = 0, finished = false;
      const stop = error => { if (finished) return; finished = true; req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('error', onError); req.removeListener('aborted', onError); if (error) { req.resume?.(); reject(error); } };
      const onData = chunk => { total += Buffer.byteLength(chunk); if (total > maximum) stop(new QnaError(413, 'BODY_TOO_LARGE', '요청 내용은 32KiB 이내로 작성해주세요.')); else chunks.push(Buffer.from(chunk)); };
      const onEnd = () => { if (finished) return; const value = Buffer.concat(chunks, total); stop(); resolve(value); };
      const onError = () => stop(new QnaError(400, 'INVALID_JSON', '요청 내용을 읽지 못했습니다.'));
      req.on('data', onData); req.on('end', onEnd); req.on('error', onError); req.on('aborted', onError);
    });
  }
  if (raw === undefined || Buffer.byteLength(raw, 'utf8') > maximum) throw new QnaError(413, 'BODY_TOO_LARGE', '요청 내용은 32KiB 이내로 작성해주세요.');
  try { return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw); }
  catch { throw new QnaError(400, 'INVALID_JSON', '올바른 JSON 요청을 보내주세요.'); }
}
function createQnaHandler({ service, env = process.env, bodyBytes = BODY_BYTES } = {}) {
  const shared = service || createPublishedQnaService({ store: createBlobStore({ env }), env });
  const allowed = origins(env);
  return async function qnaHandler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    const reply = (status, value) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    try {
      if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); throw new QnaError(405, 'METHOD_NOT_ALLOWED', '지원하지 않는 요청 방식입니다.'); }
      const origin = header(req, 'origin');
      if ((origin && !allowed.has(origin)) || (req.method === 'POST' && !origin))
        throw new QnaError(403, 'ORIGIN_NOT_ALLOWED', '운영 가이드북 페이지에서 다시 시도해주세요.');
      const configured = shared.isConfigured();
      if (!configured) return reply(503, { configured: false, canWrite: false,
        error: { code: 'STORAGE_NOT_CONFIGURED', message: '공유 저장소 연결을 준비하고 있습니다.' }, questions: [] });
      const canWrite = env.VERCEL_ENV !== 'preview';
      if (req.method === 'GET') return reply(200, { configured: true, canWrite, ...await shared.read() });
      if (!canWrite) throw new QnaError(403, 'READ_ONLY', '미리보기에서는 질문과 답변을 변경할 수 없습니다.');
      if (!/^application\/json(?:\s*;\s*charset=utf-?8)?\s*$/i.test(header(req, 'content-type'))
        || !['', 'identity'].includes(header(req, 'content-encoding').toLowerCase()))
        throw new QnaError(415, 'JSON_REQUIRED', 'JSON 형식으로 요청해주세요.');
      const command = await body(req, bodyBytes);
      return reply(200, await shared.mutate(command, { ownerKey: header(req, 'x-qna-owner'), ip: requestIP(req) }));
    } catch (error) {
      if (error instanceof QnaError) return reply(error.status, { error: { code: error.code, message: error.message } });
      return reply(503, { error: { code: 'SERVICE_UNAVAILABLE', message: '공유 QnA를 처리하지 못했습니다. 작성한 내용을 보관하고 다시 시도해주세요.' } });
    }
  };
}
module.exports = { createQnaHandler, BODY_BYTES };
