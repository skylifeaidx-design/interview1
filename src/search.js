/* Browser-local Korean guide search. No requests, logging, persistence, or dependencies. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GuideSearch = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const INITIALS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  const MAX_QUERY_LENGTH = 500;
  const compact = value => String(value == null ? '' : value).normalize('NFC').toLowerCase().replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]/g, '');
  const initials = value => Array.from(compact(value), c => {
    const n = c.charCodeAt(0) - 0xAC00;
    return n >= 0 && n <= 11171 ? INITIALS[Math.floor(n / 588)] : c;
  }).join('');
  const unique = values => [...new Set(values)];
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
  function createEngine(features, dictionary) {
    if (!Array.isArray(features)) throw new TypeError('기능 목록은 배열이어야 합니다.');
    const dict = dictionary || {};
    const replacements = (dict.replacements || []).map(([from, to]) => [String(from).toLowerCase(), String(to).toLowerCase()]).sort((a, b) => b[0].length - a[0].length);
    function rewrite(text) {
      let value = String(text == null ? '' : text).normalize('NFC').toLowerCase().slice(0, MAX_QUERY_LENGTH);
      for (const [from, to] of replacements) if (from) value = value.split(from).join(to);
      return value;
    }
    const norm = value => compact(rewrite(value));
    const stops = new Set((dict.stopwords || []).map(norm));
    const tokens = value => unique(rewrite(value).split(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ]+/).map(token => {
      let result = token;
      // Drop common particles only when a meaningful stem remains.
      for (const suffix of ['해주세요', '해주세여', '하고싶어요', '하고싶은데', '하려고요', '하려는데', '하는데요', '하려고', '했는데', '됐는데', '하고', '하려면', '보려면', '에서는', '에서', '으로', '인데', '인데요', '나요', '어요', '에요', '입니다', '를', '을', '가', '이', '은', '는', '에', '도']) {
        if (result.endsWith(suffix) && result.length - suffix.length >= 2) { result = result.slice(0, -suffix.length); break; }
      }
      return result;
    }).filter(token => token.length >= 2 && !stops.has(token)));
    const records = features.map(feature => ({
      feature, title: norm(feature.title), aliases: (feature.aliases || []).map(norm),
      titleInitials: initials(feature.title), aliasInitials: (feature.aliases || []).map(initials),
      context: norm([feature.major, feature.middle, feature.product].join(' ')),
      description: norm(feature.summary),
      steps: norm((feature.steps || []).join(' '))
    }));
    const ids = new Set(features.map(f => f.id));
    const intentDefinitions = (dict.intents || []).map(intent => ({ ...intent, targetSet: new Set((intent.targets || []).map(norm)) }));
    function hasAny(text, list) { return (list || []).some(term => norm(term) && text.includes(norm(term))); }
    function hasAll(text, groups) { return (groups || []).every(group => hasAny(text, Array.isArray(group) ? group : [group])); }
    function matchesRule(text, rule) {
      return !hasAny(text, rule.excludeAny || rule.none) && (!rule.any || hasAny(text, rule.any)) && (!rule.all || hasAll(text, rule.all));
    }
    function detectProducts(text) {
      return (dict.productGroups || []).filter(group => hasAny(text, group.terms)).map(group => group.product);
    }
    function detectIntents(text) {
      const hits = intentDefinitions.map(intent => {
        if (hasAny(text, intent.excludeAny) || (intent.requireAny && !hasAny(text, intent.requireAny))) return null;
        const matched = (intent.phrases || []).filter(phrase => text.includes(norm(phrase)));
        let strength = matched.length ? 12 + Math.min(22, Math.max(...matched.map(p => norm(p).length)) * 2) + Math.min(8, (matched.length - 1) * 2) : 0;
        for (const rule of intent.rules || []) if (matchesRule(text, rule)) strength = Math.max(strength, Number(rule.weight) || 25);
        return strength ? { definition: intent, strength, terms: matched } : null;
      }).filter(Boolean).sort((a, b) => b.strength - a.strength);
      if (hits.length || text.length < 3 || text.length > 14) return hits;
      // For a short misspelled query, compare Jamo with phrases from the same editable dictionary.
      const a = text.normalize('NFD');
      const limit = a.length >= 12 ? 2 : 1;
      for (const intent of intentDefinitions) {
        if (hasAny(text, intent.excludeAny)) continue;
        const phrase = (intent.phrases || []).find(value => {
          const candidate = norm(value);
          if (candidate.length < 3 || Math.abs(candidate.length - text.length) > 1) return false;
          const b = candidate.normalize('NFD');
          return distance(a, b, limit) <= limit;
        });
        if (phrase) hits.push({ definition: intent, strength: 8, terms: [phrase], typo: true });
      }
      return hits;
    }
    function filterRecord(record, filters) {
      const f = record.feature;
      if (filters.major && f.major !== filters.major) return false;
      if (filters.middle && f.middle !== filters.middle) return false;
      if (filters.minor && f.minor !== filters.minor) return false;
      if (filters.product && f.product !== filters.product) return false;
      if ((filters.login === 'required' || filters.login === true) && !f.login) return false;
      if ((filters.login === 'public' || filters.login === false) && f.login) return false;
      if (filters.availability && (!f.availability || f.availability.mode !== filters.availability)) return false;
      if (filters.action && f.action !== filters.action) return false;
      if (Array.isArray(filters.scope) && !filters.scope.includes(f.id)) return false;
      if (filters.scope && typeof filters.scope.has === 'function' && !filters.scope.has(f.id)) return false;
      return true;
    }
    function typoCandidate(text, queryTokens, record) {
      const candidates = [record.title, ...record.aliases].filter(term => term.length >= 3 && term.length <= 30);
      const probes = unique([text, ...queryTokens]).filter(term => term.length >= 3 && term.length <= 24);
      for (const probe of probes) {
        for (const candidate of candidates) {
          if (Math.abs(probe.length - candidate.length) > 1) continue;
          const a = probe.normalize('NFD'), b = candidate.normalize('NFD');
          const limit = a.length >= 12 ? 2 : 1;
          if (distance(a, b, limit) <= limit) return candidate;
        }
      }
      return '';
    }
    function search(query, filters) {
      filters = filters || {};
      const raw = String(query == null ? '' : query).slice(0, MAX_QUERY_LENGTH).trim();
      const text = norm(raw), queryTokens = tokens(raw);
      const empty = !text;
      const products = detectProducts(text);
      const inferredProduct = products[0] || '';
      const detected = detectIntents(text);
      const topIntent = detected[0];
      const exact = records.some(r => r.title === text);
      const unsupported = !empty && !exact ? (dict.unsupported || []).find(rule => matchesRule(text, rule)) : null;
      const clarification = !empty && !unsupported ? (dict.clarifications || []).find(rule => matchesRule(text, rule)) : null;
      const intent = unsupported ? { id: unsupported.id, label: unsupported.label, product: inferredProduct, action: '', unsupported: true } : clarification ? { id: clarification.id, label: clarification.label, product: inferredProduct, action: '', ambiguous: true } : { id: topIntent ? topIntent.definition.id : '', label: topIntent ? topIntent.definition.label : '', product: inferredProduct, action: topIntent ? topIntent.definition.action || '' : '' };
      let correction;
      const corrected = rewrite(raw);
      if (compact(raw) !== compact(corrected) && !/^(as|esim|usim)$/i.test(compact(raw))) correction = corrected;
      if (unsupported) return { items: [], suggestions: unsupported.suggestions || ['고객센터 안내'], normalizedQuery: text, intent, total: 0, lowConfidence: true, ...(correction ? { correction } : {}) };
      const isInitial = /^[ㄱ-ㅎ]{2,}$/.test(text);
      let items = records.filter(record => filterRecord(record, filters)).map(record => {
        const f = record.feature;
        let score = 0, matchType = '', reason = '', matchedTerms = [];
        function add(value, type, explanation, terms) {
          if (value > score) { score = value; matchType = type; reason = explanation; }
          if (terms) matchedTerms.push(...terms);
        }
        if (empty) return { feature: f, score: 0, matchType: 'browse', matchedTerms: [], reason: '' };
        if (record.title === text) add(300, 'exact', '기능명과 정확히 일치합니다.', [f.title]);
        if (record.aliases.includes(text)) add(275, 'alias', '등록된 고객 표현과 일치합니다.', [f.aliases[record.aliases.indexOf(text)]]);
        if (isInitial) {
          if (record.titleInitials.includes(text)) add(record.titleInitials === text ? 260 : 210, 'initials', '기능명의 초성과 일치합니다.', [f.title]);
          else if (record.aliasInitials.some(v => v.includes(text))) add(190, 'initials', '관련 표현의 초성과 일치합니다.', [text]);
        } else {
          if (text.length >= 2 && record.title.includes(text)) add(205 + text.length, 'title', '기능명에 검색어가 포함됩니다.', [raw]);
          if (text.length >= 2 && record.aliases.some(v => v.includes(text))) add(185 + Math.min(text.length, 15), 'alias', '관련 고객 표현에 검색어가 포함됩니다.', [raw]);
          if (record.title.length >= 4 && text.includes(record.title)) add(180 + Math.min(record.title.length, 15), 'title', '입력 문장에서 기능명을 찾았습니다.', [f.title]);
          const genericAliases = ['모바일', '인터넷', '공통', '사업자', '가입', '상담', '문의', '궁금해', '요금확인'];
          const contained = record.aliases.filter(v => v.length >= 3 && !genericAliases.includes(v) && !stops.has(v) && text.includes(v));
          if (contained.length) add(151 + Math.min(15, Math.max(...contained.map(v => v.length))), 'alias', '입력 문장과 관련된 고객 표현을 찾았습니다.', contained);
          const matchingTokens = queryTokens.filter(t => record.title.includes(t) || record.aliases.some(a => a.includes(t)));
          if (matchingTokens.length) {
            const ratio = matchingTokens.length / Math.max(queryTokens.length, 1);
            add(35 + matchingTokens.length * 13 + ratio * 25, 'keywords', '기능명·관련 표현에서 핵심 단어를 찾았습니다.', matchingTokens);
          }
          for (const hit of detected) {
            if (!hit.definition.targetSet.has(record.title)) continue;
            const isPrimary = hit === topIntent;
            add((hit.typo ? 130 : isPrimary ? 190 : 135) + hit.strength, hit.typo ? 'typo' : 'intent', hit.typo ? '한글 자모를 비교해 ' + hit.definition.label + ' 관련 표현을 찾았습니다.' : hit.definition.label + ' 관련 기능입니다.', hit.terms);
          }
          if (!score && text.length >= 3 && record.description.includes(text)) add(55, 'description', '기능 설명에서 검색어를 찾았습니다.', [raw]);
          if (!score) {
            const count = queryTokens.filter(t => record.description.includes(t)).length;
            if (count && count / Math.max(queryTokens.length, 1) >= 0.5) add(28 + count * 7, 'description', '기능 설명에 관련 단어가 있습니다.', queryTokens.filter(t => record.description.includes(t)));
          }
          if (score < 80) {
            const candidate = typoCandidate(text, queryTokens, record);
            if (candidate) add(112, 'typo', '한글 자모를 비교해 비슷한 표현을 찾았습니다.', [candidate]);
          }
        }
        if (!score) return null;
        // Product and task are independent. Common functions remain eligible for all products.
        if (products.length) {
          const compatible = products.some(product => f.product === product || String(f.product).split('·').includes(product));
          if (compatible) score += 28;
          else if (f.product !== '공통') score -= 95;
        } else if (f.product === '사업자') score -= 55;
        // A history request should not send the counselor to a new application screen.
        const wantsHistory = /내역|이력|일정|답변|신청확인|진행상태/.test(text);
        if (wantsHistory && /내역|이력/.test(f.title)) score += 20;
        else if (wantsHistory && f.action === '신청') score -= 55;
        if (topIntent && !topIntent.definition.targetSet.has(record.title) && score < 250) score -= 20;
        return { feature: f, score: Math.round(score), matchType, matchedTerms: unique(matchedTerms).slice(0, 5), reason };
      }).filter(item => item && (empty || item.score >= 46)).sort((a, b) => b.score - a.score || Number(a.feature.priority ?? 100) - Number(b.feature.priority ?? 100) || a.feature.title.localeCompare(b.feature.title, 'ko'));
      if (!empty && items.length) {
        const best = items[0].score;
        // Suppress incidental description hits when a confident destination was identified.
        if (best >= 190) items = items.filter(item => item.score >= 90 && item.score >= best - 125);
        else if (best >= 110) items = items.filter(item => item.score >= 62);
      }
      if (!correction && items[0] && items[0].matchType === 'typo') correction = items[0].feature.title;
      const lowConfidence = !!clarification || (!empty && (!items.length || items[0].score < 110));
      const suggestions = clarification ? clarification.suggestions || [] : !items.length && !empty ? ['고객센터 안내', '자주 찾는 질문', ...(dict.popular || []).slice(0, 3)] : lowConfidence ? (dict.popular || []).slice(0, 4) : [];
      return { items, suggestions: unique(suggestions), normalizedQuery: text, intent, total: items.length, lowConfidence, ...(correction ? { correction } : {}) };
    }
    function suggest(query) {
      const text = norm(query);
      if (!text) return (dict.popular || []).slice(0, 7).map(value => ({ text: value, label: '자주 찾는 업무', type: 'popular' }));
      const result = search(query);
      const out = [];
      for (const value of result.suggestions) out.push({ text: value, label: result.intent.unsupported ? '대체 안내 경로' : '검색어 제안', type: 'suggestion' });
      for (const item of result.items) if (item.score >= 90) out.push({ text: item.feature.title, label: item.feature.major + ' · ' + item.feature.product, type: item.matchType });
      return out.filter((item, i, list) => list.findIndex(other => other.text === item.text) === i).slice(0, 7);
    }
    return Object.freeze({ search, suggest, size: ids.size, dictionaryVersion: dict.version || 0 });
  }
  return Object.freeze({ createEngine, normalize: compact, initials });
});
