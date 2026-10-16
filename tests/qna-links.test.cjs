const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/qna.js'),'utf8');
const esc=source.match(/const esc=value=>[^\n]+/)[0],body=source.match(/function bodyHTML\(value\)\{[\s\S]*?\n \}/)[0];
const render=input=>vm.runInNewContext(esc+'\n'+body+'\nbodyHTML(input)',{URL,input});
test('QnA의 홈페이지와 기능 근거 링크만 안전한 새 창 링크로 표시한다',()=>{
 const output=render('메뉴 https://www.skylife.co.kr/my/charge/pay/inquiry\n가이드 https://interview1-chi.vercel.app/#guide=f-1234567890');
 assert.equal((output.match(/<a /g)||[]).length,2);assert(output.includes('target="_blank" rel="noopener noreferrer"'));assert(output.includes('#guide=f-1234567890'));
});
test('QnA 본문의 HTML·가짜 도메인·자격정보·비표준 포트는 실행 링크가 되지 않는다',()=>{
 const output=render('<img src=x onerror=alert(1)> javascript:alert(1) https://www.skylife.co.kr.evil.example/ https://user:pass@www.skylife.co.kr/ https://www.skylife.co.kr:8443/ https://evil.example/');
 assert(!output.includes('<img'));assert(output.includes('&lt;img'));assert(!output.includes('<a '));assert(!output.includes('href="javascript:'));
});
test('QnA 링크의 따옴표·앰퍼샌드·문장부호는 속성이나 문서 구조를 닫지 않는다',()=>{
 const output=render('https://www.skylife.co.kr/center/faq?type=2&word=esim). <script>alert(1)</script>');
 assert(output.includes('word=esim"'));assert(output.includes('&amp;word'));assert(output.includes('</a>).'));assert(!output.includes('<script>'));
});
