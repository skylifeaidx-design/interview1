"""Validate reviewed drafts against local homepage sources and prepare the publish manifest."""
import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlparse

PROJECT = Path(__file__).resolve().parents[1]
CATEGORIES = {'요금·납부','가입·상품','이용·변경','장애·A/S','문의·고객지원','회원·계정','혜택·콘텐츠','사업자 지원','기타'}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--homepage-root', type=Path, required=True)
    parser.add_argument('--expected-count', type=int, default=100)
    parser.add_argument('--revision', type=int, default=2026101601)
    parser.add_argument('--reviewed-at', default='2026-10-16')
    parser.add_argument('drafts', nargs='+', type=Path)
    args = parser.parse_args()
    home = args.homepage_root.resolve()
    features = {f['id']: f for path in (PROJECT / 'content/features').glob('*.json') for f in [json.loads(path.read_text(encoding='utf-8'))]}
    entries = [item for file in args.drafts for item in json.loads(file.read_text(encoding='utf-8-sig'))]
    if len(entries) != args.expected_count:
        raise ValueError(f'검토할 샘플은 {args.expected_count}개여야 합니다: {len(entries)}개')
    keys, titles, questions = set(), set(), []
    for item in entries:
        key, title = item['key'].lower(), item['title'].strip()
        if key in keys or title in titles:
            raise ValueError(f'중복 식별자 또는 제목: {key}')
        keys.add(key); titles.add(title)
        if item['category'] not in CATEGORIES or not item.get('featureIds') or any(fid not in features for fid in item['featureIds']):
            raise ValueError(f'분류 또는 관련 기능 확인 필요: {key}')
        if not item.get('sourceFiles') or not item.get('sourceEvidence') or item.get('support') not in {'direct','inquiry','information'}:
            raise ValueError(f'근거 또는 처리 구분 누락: {key}')
        sources = []
        for source in item['sourceFiles']:
            path = (home / source['file']).resolve()
            if not path.is_relative_to(home) or path.suffix not in {'.js','.jsx','.ts','.tsx','.json','.md'} or any(part.startswith('.') for part in Path(source['file']).parts):
                raise ValueError(f'허용된 홈페이지 소스 경로가 아닙니다: {key}')
            if not path.is_file() or not isinstance(source['line'], int) or source['line'] < 1 or source['line'] > len(path.read_text(encoding='utf-8-sig').splitlines()):
                raise ValueError(f'실제 소스와 줄번호 확인 필요: {key}')
            sources.append({**source, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
        for evidence in item['sourceEvidence']:
            url = urlparse(evidence['url'])
            if url.scheme != 'https' or not url.hostname or url.username or url.password or url.port or evidence['role'] not in {'topic','skylife-policy','feature'}:
                raise ValueError(f'안전한 공식 근거 URL 확인 필요: {key}')
        answer = item['answer'].replace('\\n', '\n').strip()
        question = item['question'].replace('\\n', '\n').strip()
        if '\ufffd' in json.dumps(item, ensure_ascii=False):
            raise ValueError(f'문자 인코딩 손상 확인 필요: {key}')
        if not question or not answer or len(title) > 120:
            raise ValueError(f'본문 또는 제목 확인 필요: {key}')
        # Mark generated examples explicitly, while retaining the counselor-facing question style.
        body = question + '\n\n※ 홈페이지 기능 안내를 위해 작성한 샘플 질문입니다.'
        if 'https://www.skylife.co.kr' not in answer:
            primary = next((e['url'] for e in item['sourceEvidence'] if e['role'] in {'skylife-policy','feature'} and urlparse(e['url']).hostname == 'www.skylife.co.kr'), None)
            answer += '\n\n홈페이지: ' + (primary or features[item['featureIds'][0]]['url'])
        if 'interview1-chi.vercel.app/#guide=' not in answer:
            answer += '\n관련 기능 가이드: https://interview1-chi.vercel.app/#guide=' + item['featureIds'][0]
        answer += f'\n\n확인 기준: {args.reviewed_at} · 홈페이지 소스·공개 안내를 대조한 샘플 답변입니다. 고객별 이용 가능 여부는 로그인 후 현재 화면에서 확인해주세요.'
        if len(body) > 4000 or len(answer) > 4000 or len(item.get('tags', [])) > 8 or any(len(tag) > 24 for tag in item.get('tags', [])):
            raise ValueError(f'저장 항목 길이 초과: {key}')
        questions.append({'key': key,'title': title,'body': body,'answer': answer,'category': item['category'],'tags': item.get('tags', []),
            'featureIds': item['featureIds'],'support': item['support'],'sourceFiles': sources,'sourceEvidence': item['sourceEvidence']})
    output = {'schemaVersion': 1,'publicationId': 'skylife-faq-samples-20261016','revision': args.revision,'reviewedAt': args.reviewed_at,
        'description': f'공식 FAQ의 문의 주제를 참고하고 현재 홈페이지 소스로 가능 범위를 검토한 {len(questions)}개 샘플. 실제 이용자 문의나 문의량 순위를 뜻하지 않습니다.',
        'questions': questions}
    with (PROJECT / 'content/qna-samples.json').open('w', encoding='utf-8', newline='\n') as target:
        target.write(json.dumps(output, ensure_ascii=False, indent=2)+'\n')
    counts = {category: sum(q['category'] == category for q in questions) for category in sorted(CATEGORIES)}
    print(json.dumps({'검증': '통과','samples': len(questions),'categories': {k:v for k,v in counts.items() if v}}, ensure_ascii=False))

if __name__ == '__main__':
    main()
