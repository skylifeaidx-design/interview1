/* Plain-text search over participant QnA already loaded in browser memory. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./search.js'));
  else root.GuideQnASearch = factory(root.GuideSearch);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (shared) {
  'use strict';
  const MAX_QUERY_LENGTH = 500;
  const CHOSEONG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const compact = shared && shared.normalize || (value => String(value == null ? '' : value).normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, ''));
  const initials = shared && shared.initials || (value => Array.from(compact(value), c => {
    const n = c.charCodeAt(0) - 0xAC00;
    return n >= 0 && n <= 11171 ? CHOSEONG[Math.floor(n / 588)] : c;
  }).join(''));
  const unique = values => [...new Set(values)];
  const broadWords = new Set(['신청', '변경', '등록', '해제', '구매', '사용', '질문', '답변', '확인', '문의', '절차', '방법', '안내', '어떻게', '관련', '대한', '대해', '하나요', '되나요', '있나요', '싶어요', '싶은데', '고객님']);
  function makeNormalizer(dictionary) {
    // Per-call memoization avoids repeatedly normalizing dictionary phrases and repeated tags.
    // These maps are discarded after search; questions and search phrases are never persisted.
    const rewritten = new Map(), normalized = new Map();
    const replacements = (Array.isArray(dictionary.replacements) ? dictionary.replacements : [])
      .filter(pair => Array.isArray(pair) && pair.length >= 2 && typeof pair[0] === 'string' && pair[0])
      .map(([from, to]) => [from.normalize('NFC').toLowerCase(), String(to == null ? '' : to).normalize('NFC').toLowerCase()])
      .sort((a, b) => b[0].length - a[0].length);
    function rewrite(value) {
      const key = String(value == null ? '' : value);
      if (rewritten.has(key)) return rewritten.get(key);
      let text = key.normalize('NFC').toLowerCase();
      for (const [from, to] of replacements) text = text.split(from).join(to);
      rewritten.set(key, text);
      return text;
    }
    function normalizeValue(value) {
      const key = String(value == null ? '' : value);
      if (!normalized.has(key)) normalized.set(key, compact(rewrite(key)));
      return normalized.get(key);
    }
    return { rewrite, normalize: normalizeValue };
  }
  function normalize(value, dictionary) { return makeNormalizer(dictionary || {}).normalize(value); }
  function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1;
    let row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      let min = i;
      for (let j = 1; j <= b.length; j++) {
        next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        min = Math.min(min, next[j]);
      }
      if (min > limit) return limit + 1;
      row = next;
    }
    return row[b.length];
  }
  function timestamp(question) {
    const value = Date.parse(question.updatedAt || question.createdAt || '');
    return Number.isFinite(value) ? value : 0;
  }
  function search(questions, query, dictionary) {
    if (!Array.isArray(questions)) return [];
    const dict = dictionary || {};
    const { rewrite, normalize: norm } = makeNormalizer(dict);
    const raw = String(query == null ? '' : query).slice(0, MAX_QUERY_LENGTH).trim();
    const text = norm(raw);
    const records = questions.filter(question => question && typeof question === 'object');
    if (!text) return records.slice().sort((a, b) => timestamp(b) - timestamp(a)).map(question => ({ question, score: 0, matchedTerms: [], reason: '최근 수정된 질문입니다.' }));
    const stops = new Set([...(Array.isArray(dict.stopwords) ? dict.stopwords : []), ...broadWords].map(norm));
    function tokens(value) {
      return unique(rewrite(value).split(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/).map(token => {
        for (const suffix of ['해주세요', '하고싶어요', '하려는데', '하는데요', '하려고', '했는데', '하려면', '보려면', '에서는', '에서', '으로', '인가요', '나요', '어요', '에요', '입니다', '를', '을', '가', '이', '은', '는', '에', '도']) {
          if (token.endsWith(suffix) && token.length - suffix.length >= 2) return token.slice(0, -suffix.length);
        }
        return token;
      }).filter(token => token.length >= 2));
    }
    const allTokens = tokens(raw);
    const significant = allTokens.filter(token => !stops.has(token));
    const queryTokens = significant.length ? significant : allTokens;
    const hasAny = (value, terms) => (Array.isArray(terms) ? terms : []).some(term => norm(term) && value.includes(norm(term)));
    // Only expand phrases associated with an actual dictionary group. No QnA or answer is generated.
    const groups = (Array.isArray(dict.intents) ? dict.intents : []).filter(intent => {
      if (!intent || hasAny(text, intent.excludeAny)) return false;
      return hasAny(text, intent.phrases);
    }).map(intent => {
      const found = intent.phrases.filter(term => text.includes(norm(term)));
      const strength = Math.max(...found.map(term => norm(term).length));
      const terms = unique([...(intent.phrases || []), ...(intent.targets || []), intent.label || ''].map(norm)).filter(term => term.length >= 3 && !stops.has(term));
      return { terms, strength, excludeAny: intent.excludeAny };
    }).sort((a, b) => b.strength - a.strength);
    const activeGroups = groups.length ? groups.filter(group => group.strength === groups[0].strength).slice(0, 2) : [];
    const isInitial = /^[ㄱ-ㅎ]{2,}$/.test(text);
    const matches = records.map(question => {
      const fields = [
        { value: question.title, label: '질문 제목', weight: 130, kind: 'title' },
        ...(Array.isArray(question.tags) ? question.tags : []).map(value => ({ value, label: '태그', weight: 125, kind: 'tag' })),
        { value: question.category, label: '분류', weight: 85, kind: 'category' },
        { value: question.body, label: '질문 본문', weight: 75, kind: 'body' },
        ...(Array.isArray(question.answers) ? question.answers : []).filter(answer => answer && typeof answer === 'object').map(answer => ({ value: answer.body, label: '답변 본문', weight: 70, kind: 'answer' }))
      ].map(field => ({ ...field, text: norm(field.value) })).filter(field => field.text);
      let score = 0, reason = '', matchedTerms = [];
      function choose(value, label, terms) {
        if (value > score) { score = value; reason = label; }
        matchedTerms.push(...terms);
      }
      for (const field of fields) {
        if (isInitial) {
          if (initials(rewrite(field.value)).includes(text)) choose(field.weight + (initials(rewrite(field.value)) === text ? 25 : 0), field.label + '의 초성과 일치합니다.', [raw]);
          continue;
        }
        if (field.text === text) choose(field.weight + 100, field.label + '와 정확히 일치합니다.', [raw]);
        else if (field.text.includes(text)) choose(field.weight + 45, field.label + '에 검색어가 포함됩니다.', [raw]);
        const matched = queryTokens.filter(token => field.text.includes(token));
        if (matched.length) {
          const coverage = matched.length / Math.max(1, queryTokens.length);
          if (coverage >= 0.5) choose(field.weight * 0.45 + matched.length * 8 + coverage * 25, field.label + '에서 핵심 단어가 일치합니다.', matched);
        }
        for (const group of activeGroups) {
          if (hasAny(field.text, group.excludeAny)) continue;
          const related = group.terms.filter(term => field.text.includes(term));
          if (related.length) choose(field.weight * 0.45 + 18, field.label + '에서 사전의 관련 표현을 찾았습니다.', related.slice(0, 3));
        }
      }
      if (!score && !isInitial) {
        const probes = unique([text, ...queryTokens]).filter(term => term.length >= 3 && term.length <= 20).slice(0, 12);
        for (const field of fields) {
          const candidates = unique([field.text, ...tokens(field.value)]).filter(term => term.length >= 3 && term.length <= 24).slice(0, 800);
          const typo = candidates.find(candidate => probes.some(probe => {
            if (Math.abs(probe.length - candidate.length) > 1) return false;
            const a = probe.normalize('NFD'), b = candidate.normalize('NFD');
            return distance(a, b, a.length >= 12 ? 2 : 1) <= (a.length >= 12 ? 2 : 1);
          }));
          if (typo) choose(field.weight * 0.4 + 15, field.label + '에서 한글 자모가 비슷한 표현을 찾았습니다.', [typo]);
        }
      }
      return score ? { question, score: Math.round(score), matchedTerms: unique(matchedTerms).slice(0, 5), reason } : null;
    }).filter(Boolean);
    return matches.sort((a, b) => b.score - a.score || timestamp(b.question) - timestamp(a.question));
  }
  return Object.freeze({ search, normalize });
});
