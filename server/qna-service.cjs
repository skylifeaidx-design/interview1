const crypto = require('node:crypto');

const DEFAULT_LIMITS = Object.freeze({
  snapshotBytes: 4 * 1024 * 1024, questions: 500, answers: 50,
  title: 120, body: 4000, category: 40, author: 30, tags: 8, tag: 24,
  audit: 100, retries: 5, ipWrites: 120, ownerWrites: 30, globalWrites: 500,
  actorWindowMs: 15 * 60 * 1000, globalWindowMs: 60 * 60 * 1000,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUESTION_ID = /^q-[0-9a-f-]{36}$/i;
const ANSWER_ID = /^a-[0-9a-f-]{36}$/i;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/;
const PHONE = /(?:^|[^\d])010[ -]?\d{4}[ -]?\d{4}(?!\d)/;
const RESIDENT_ID = /(?:^|[^\d])\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[ -]?[1-8]\d{6}(?!\d)/;

class QnaError extends Error {
  constructor(status, code, message, details) {
    super(message); this.name = 'QnaError'; this.status = status; this.code = code;
    if (details) this.details = details;
  }
}
class QnaStoreConflictError extends Error {
  constructor() { super('공유 파일의 버전이 변경되었습니다.'); this.name = 'QnaStoreConflictError'; }
}
const fail = (status, code, message, details) => { throw new QnaError(status, code, message, details); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
const hashOwner = key => crypto.createHash('sha256').update(key).digest('hex');
function validOwnerKey(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(key)) return false;
  const decoded = Buffer.from(key, 'base64url');
  return decoded.length === 32 && decoded.toString('base64url') === key;
}
function owns(record, ownerHash) {
  return typeof record.ownerHash === 'string' && /^[a-f0-9]{64}$/.test(record.ownerHash)
    && crypto.timingSafeEqual(Buffer.from(record.ownerHash, 'hex'), Buffer.from(ownerHash, 'hex'));
}
function assertOwner(record, ownerHash) {
  if (!owns(record, ownerHash)) fail(403, 'NOT_OWNER', '이 항목을 작성한 브라우저에서만 수정하거나 삭제할 수 있습니다.');
}
function assertVersion(record, expectedVersion) {
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
    fail(400, 'INVALID_VERSION', '수정할 항목의 버전을 확인해주세요.');
  if (record.version !== expectedVersion)
    fail(409, 'VERSION_CONFLICT', '다른 변경사항이 저장되었습니다. 작성 중인 내용을 보관한 뒤 최신 내용을 확인해주세요.');
}
function text(value, name, maximum, { required = true, multiline = false, fallback = '' } = {}) {
  if (value === undefined || value === null) value = fallback;
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${name} 항목은 글자로 입력해주세요.`);
  value = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  if (CONTROL.test(value) || (!multiline && /[\n\t]/.test(value)))
    fail(400, 'INVALID_INPUT', `${name} 항목에 사용할 수 없는 제어문자가 있습니다.`);
  if ((required && !value) || value.length > maximum)
    fail(400, 'INVALID_INPUT', `${name} 항목은 ${maximum}자 이내로 입력해주세요.`);
  if (PHONE.test(value) || RESIDENT_ID.test(value))
    fail(400, 'PERSONAL_INFORMATION', '개인 휴대전화번호나 주민등록번호를 제외하고 작성해주세요.');
  return value;
}
function questionFields(value, limits) {
  if (!object(value)) fail(400, 'INVALID_INPUT', '질문 내용을 확인해주세요.');
  const tags = value.tags === undefined ? [] : value.tags;
  if (!Array.isArray(tags) || tags.length > limits.tags)
    fail(400, 'INVALID_INPUT', `태그는 ${limits.tags}개까지 입력할 수 있습니다.`);
  return {
    title: text(value.title, '질문 제목', limits.title),
    body: text(value.body, '질문 내용', limits.body, { required: false, multiline: true }),
    category: text(value.category, '질문 분류', limits.category, { fallback: '일반' }),
    tags: [...new Set(tags.map(tag => text(tag, '태그', limits.tag)))],
    author: text(value.author === undefined || value.author === null || value.author === '' ? '익명 참여자' : value.author, '작성자 표시', limits.author),
  };
}
function answerFields(value, limits) {
  if (!object(value)) fail(400, 'INVALID_INPUT', '답변 내용을 확인해주세요.');
  return {
    body: text(value.body, '답변 내용', limits.body, { multiline: true }),
    author: text(value.author === undefined || value.author === null || value.author === '' ? '익명 참여자' : value.author, '작성자 표시', limits.author),
  };
}
function normalizeCommand(input, limits) {
  if (!object(input)) fail(400, 'INVALID_INPUT', '요청 내용을 확인해주세요.');
  if (input.website !== undefined && (typeof input.website !== 'string' || input.website.trim()))
    fail(400, 'SPAM_REJECTED', '요청 내용을 확인한 뒤 다시 시도해주세요.');
  const action = input.action;
  if (!['create-question', 'create-answer', 'update-question', 'update-answer', 'delete-question', 'delete-answer'].includes(action))
    fail(400, 'INVALID_ACTION', '지원하지 않는 변경 요청입니다.');
  const command = { action };
  if (action.startsWith('create-')) {
    if (typeof input.requestId !== 'string' || !UUID.test(input.requestId))
      fail(400, 'INVALID_REQUEST_ID', '등록 요청의 식별자를 확인해주세요.');
    command.requestId = input.requestId.toLowerCase();
  }
  if (action !== 'create-question') {
    if (typeof input.questionId !== 'string' || !QUESTION_ID.test(input.questionId)
      || !UUID.test(input.questionId.slice(2))) fail(400, 'INVALID_ID', '질문 식별자를 확인해주세요.');
    command.questionId = input.questionId.toLowerCase();
  }
  if (action === 'update-answer' || action === 'delete-answer') {
    if (typeof input.answerId !== 'string' || !ANSWER_ID.test(input.answerId)
      || !UUID.test(input.answerId.slice(2))) fail(400, 'INVALID_ID', '답변 식별자를 확인해주세요.');
    command.answerId = input.answerId.toLowerCase();
  }
  if (action.startsWith('update-') || action.startsWith('delete-')) command.expectedVersion = input.expectedVersion;
  if (action === 'create-question' || action === 'update-question') command.question = questionFields(input.question, limits);
  if (action === 'create-answer' || action === 'update-answer') command.answer = answerFields(input.answer, limits);
  return command;
}
function publicAnswer(answer) {
  return { id: answer.id, body: answer.body, author: answer.author, createdAt: answer.createdAt,
    updatedAt: answer.updatedAt, version: answer.version };
}
function publicQuestion(question) {
  return { id: question.id, title: question.title, body: question.body, category: question.category,
    tags: [...question.tags], author: question.author, createdAt: question.createdAt,
    updatedAt: question.updatedAt, version: question.version, answers: question.answers.map(publicAnswer) };
}
function emptySnapshot() {
  return { schemaVersion: 1, questions: [], audit: [], rates: [], rateSalt: crypto.randomBytes(32).toString('base64url') };
}
function checkedSnapshot(value, limits) {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.questions)
    || !Array.isArray(value.audit) || !Array.isArray(value.rates)
    || typeof value.rateSalt !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.rateSalt)
    || value.questions.length > limits.questions || value.audit.length > limits.audit || bytes(value) > limits.snapshotBytes)
    fail(503, 'STORAGE_INVALID', '공유 저장 내용을 확인하고 있습니다. 잠시 후 다시 시도해주세요.');
  const ids = new Set();
  for (const question of value.questions) {
    if (!object(question) || !QUESTION_ID.test(question.id) || ids.has(question.id)
      || !Array.isArray(question.answers) || question.answers.length > limits.answers || !Array.isArray(question.tags)
      || question.tags.length > limits.tags || !question.tags.every(tag => typeof tag === 'string' && tag.length <= limits.tag)
      || !Number.isSafeInteger(question.version) || question.version < 1 || !/^[a-f0-9]{64}$/.test(question.ownerHash)
      || !['title', 'body', 'category', 'author', 'createdAt', 'updatedAt'].every(key => typeof question[key] === 'string'))
      fail(503, 'STORAGE_INVALID', '공유 저장 내용을 확인하고 있습니다. 잠시 후 다시 시도해주세요.');
    ids.add(question.id);
    for (const answer of question.answers) {
      if (!object(answer) || !ANSWER_ID.test(answer.id) || ids.has(answer.id)
        || !Number.isSafeInteger(answer.version) || answer.version < 1 || !/^[a-f0-9]{64}$/.test(answer.ownerHash)
        || !['body', 'author', 'createdAt', 'updatedAt'].every(key => typeof answer[key] === 'string'))
        fail(503, 'STORAGE_INVALID', '공유 저장 내용을 확인하고 있습니다. 잠시 후 다시 시도해주세요.');
      ids.add(answer.id);
    }
  }
  return clone(value);
}
function rateLimit(snapshot, ownerHash, ip, timestamp, limits) {
  const actorStart = Math.floor(timestamp / limits.actorWindowMs) * limits.actorWindowMs;
  const globalStart = Math.floor(timestamp / limits.globalWindowMs) * limits.globalWindowMs;
  snapshot.rates = snapshot.rates.filter(rate => object(rate) && ['ip', 'owner', 'global'].includes(rate.kind)
    && rate.start === (rate.kind === 'global' ? globalStart : actorStart)
    && typeof rate.key === 'string' && rate.key.length <= 64 && Number.isSafeInteger(rate.count) && rate.count >= 0);
  const ipHash = crypto.createHmac('sha256', snapshot.rateSalt).update(String(ip || 'unknown').slice(0, 128)).digest('hex');
  const groups = [
    ['ip', ipHash, actorStart, limits.ipWrites],
    ['owner', ownerHash, actorStart, limits.ownerWrites],
    ['global', 'all', globalStart, limits.globalWrites],
  ];
  for (const [kind, key, start, maximum] of groups) {
    const rate = snapshot.rates.find(value => value.kind === kind && value.key === key && value.start === start);
    if ((rate?.count || 0) >= maximum) fail(429, 'RATE_LIMITED', '저장 요청이 많습니다. 잠시 후 다시 시도해주세요.');
  }
  for (const [kind, key, start] of groups) {
    const rate = snapshot.rates.find(value => value.kind === kind && value.key === key && value.start === start);
    if (rate) rate.count++; else snapshot.rates.push({ kind, key, start, count: 1 });
  }
}
function duplicate(snapshot, command, ownerHash) {
  if (!command.action.startsWith('create-')) return null;
  const id = (command.action === 'create-question' ? 'q-' : 'a-') + command.requestId;
  if (command.action === 'create-question') {
    const found = snapshot.questions.find(question => question.id === id);
    if (found) { assertOwner(found, ownerHash); return { question: publicQuestion(found) }; }
  } else {
    for (const question of snapshot.questions) {
      const found = question.answers.find(answer => answer.id === id);
      if (!found) continue;
      assertOwner(found, ownerHash);
      if (question.id !== command.questionId) fail(409, 'REQUEST_CONFLICT', '이미 다른 질문에 사용한 등록 요청입니다.');
      return { question: publicQuestion(question), createdAnswerId: found.id };
    }
  }
  const removed = snapshot.audit.find(event => object(event) && event.record?.id === id);
  if (removed) { assertOwner(removed.record, ownerHash); fail(409, 'ENTRY_DELETED', '이미 삭제된 항목의 등록 요청입니다. 새로 작성해주세요.'); }
  return null;
}
function apply(snapshot, command, ownerHash, timestamp, limits) {
  const at = new Date(timestamp).toISOString();
  if (command.action === 'create-question') {
    if (snapshot.questions.length >= limits.questions) fail(409, 'QUESTION_LIMIT', '질문 저장 공간이 가득 찼습니다. 기존 질문을 정리한 뒤 등록해주세요.');
    const question = { id: 'q-' + command.requestId, ...command.question, ownerHash,
      createdAt: at, updatedAt: at, version: 1, answers: [] };
    snapshot.questions.unshift(question); return { question: publicQuestion(question) };
  }
  const question = snapshot.questions.find(value => value.id === command.questionId);
  if (!question) fail(404, 'NOT_FOUND', '해당 질문을 찾을 수 없습니다.');
  if (command.action === 'create-answer') {
    if (question.answers.length >= limits.answers) fail(409, 'ANSWER_LIMIT', '이 질문에 등록할 수 있는 답변 수를 초과했습니다.');
    const answerId = 'a-' + command.requestId;
    question.answers.push({ id: answerId, ...command.answer, ownerHash, createdAt: at, updatedAt: at, version: 1 });
    question.updatedAt = at; return { question: publicQuestion(question), createdAnswerId: answerId };
  }
  if (command.action === 'update-question' || command.action === 'delete-question') {
    assertOwner(question, ownerHash); assertVersion(question, command.expectedVersion);
    if (command.action === 'update-question') {
      Object.assign(question, command.question, { updatedAt: at, version: question.version + 1 });
      return { question: publicQuestion(question) };
    }
    if (question.answers.length) fail(409, 'QUESTION_HAS_ANSWERS', '답변이 있는 질문은 삭제할 수 없습니다.');
    snapshot.audit.unshift({ action: command.action, at, questionId: question.id, record: clone(question) });
    snapshot.audit = snapshot.audit.slice(0, limits.audit);
    snapshot.questions = snapshot.questions.filter(value => value.id !== question.id);
    return { question: null, deletedQuestionId: question.id };
  }
  const answer = question.answers.find(value => value.id === command.answerId);
  if (!answer) fail(404, 'NOT_FOUND', '해당 답변을 찾을 수 없습니다.');
  assertOwner(answer, ownerHash); assertVersion(answer, command.expectedVersion);
  if (command.action === 'update-answer') Object.assign(answer, command.answer, { updatedAt: at, version: answer.version + 1 });
  else {
    snapshot.audit.unshift({ action: command.action, at, questionId: question.id, answerId: answer.id, record: clone(answer) });
    snapshot.audit = snapshot.audit.slice(0, limits.audit);
    question.answers = question.answers.filter(value => value.id !== answer.id);
  }
  question.updatedAt = at; return { question: publicQuestion(question) };
}
function createQnaService({ store, now = Date.now, limits: overrides = {} } = {}) {
  const limits = Object.freeze({ ...DEFAULT_LIMITS, ...overrides });
  const isConfigured = () => Boolean(store && (typeof store.configured !== 'function' || store.configured()));
  function configured() {
    if (!isConfigured()) fail(503, 'STORAGE_NOT_CONFIGURED', '공유 저장소 연결을 준비하고 있습니다.');
  }
  async function readStored() {
    try {
      const result = await store.read();
      if (!result) return null;
      if (typeof result.etag !== 'string' || !result.etag) fail(503, 'STORAGE_INVALID', '공유 저장 내용을 확인하고 있습니다. 잠시 후 다시 시도해주세요.');
      return { value: checkedSnapshot(result.value, limits), etag: result.etag };
    } catch (error) {
      if (error instanceof QnaError) throw error;
      fail(503, 'STORAGE_UNAVAILABLE', '공유 저장소에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.');
    }
  }
  return {
    isConfigured,
    async read() { configured(); const current = await readStored(); return { questions: current ? current.value.questions.map(publicQuestion) : [] }; },
    async mutate(input, { ownerKey, ip = 'unknown' } = {}) {
      configured();
      if (!validOwnerKey(ownerKey)) fail(400, 'INVALID_OWNER_KEY', '작성 브라우저의 관리 키를 확인해주세요.');
      const command = normalizeCommand(input, limits), ownerHash = hashOwner(ownerKey);
      for (let attempt = 0; attempt < limits.retries; attempt++) {
        const current = await readStored(); const snapshot = current ? current.value : emptySnapshot();
        const replay = duplicate(snapshot, command, ownerHash); if (replay) return replay;
        const timestamp = Number(now());
        const result = apply(snapshot, command, ownerHash, timestamp, limits);
        rateLimit(snapshot, ownerHash, ip, timestamp, limits);
        if (bytes(snapshot) > limits.snapshotBytes) fail(413, 'STORAGE_SIZE_LIMIT', '공유 저장 공간이 가득 찼습니다. 내용을 정리한 뒤 다시 시도해주세요.');
        try { await store.write(snapshot, current ? { ifMatch: current.etag } : { createOnly: true }); return result; }
        catch (error) {
          if (error instanceof QnaStoreConflictError) continue;
          if (error instanceof QnaError) throw error;
          fail(503, 'STORAGE_UNAVAILABLE', '공유 저장소에 저장하지 못했습니다. 작성한 내용을 보관하고 다시 시도해주세요.');
        }
      }
      fail(409, 'WRITE_CONFLICT', '다른 저장 요청이 처리 중입니다. 작성한 내용을 보관하고 다시 시도해주세요.');
    },
  };
}

// Explicitly injected by tests/local preview only. Production never selects this store.
function createMemoryStore({ initial = null, beforeWrite } = {}) {
  let value = initial ? clone(initial) : null, version = initial ? 1 : 0;
  return {
    configured: () => true,
    async read() { return value ? { value: clone(value), etag: String(version) } : null; },
    async write(next, options) {
      if (beforeWrite) await beforeWrite(next, options);
      if ((options.createOnly && value) || (!options.createOnly && (!value || options.ifMatch !== String(version)))) throw new QnaStoreConflictError();
      value = clone(next); version++; return { etag: String(version) };
    },
    inspect: () => value ? clone(value) : null,
  };
}
module.exports = { createQnaService, createMemoryStore, QnaError, QnaStoreConflictError, DEFAULT_LIMITS, validOwnerKey,
  emptySnapshot, checkedSnapshot, normalizeCommand };
