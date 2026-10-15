const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {loadCatalog}=require('../execution/catalog.cjs');
const {validateCatalog}=require('../execution/validate.cjs');
const root=path.resolve(__dirname,'..');
const original=loadCatalog(root);
function change(fn){const d=structuredClone(original);fn(d);return d;}
test('기능별 원본 98개와 공개 경로 검증',()=>assert.equal(validateCatalog(original,root).features,98));
test('비 HTTPS 링크·인증정보·임의 포트 차단',()=>{for(const url of ['javascript:alert(1)','http://www.skylife.co.kr/','https://name:password@www.skylife.co.kr/','https://www.skylife.co.kr:8443/']){assert.throws(()=>validateCatalog(change(d=>d.features[0].url=url),root));assert.throws(()=>validateCatalog(change(d=>d.features[0].screen.url=url),root));}});
test('임의 외부 도메인 차단',()=>assert.throws(()=>validateCatalog(change(d=>d.features[0].url='https://unapproved.example/'),root)));
test('화면 파일 경로 이탈 차단',()=>{for(const src of ['../.env','screens/../../.env','screens\\secret.jpg','screens/not-existing.jpg'])assert.throws(()=>validateCatalog(change(d=>d.features[0].screen.src=src),root));});
test('중복 ID로 공유 링크가 뒤바뀌지 않게 차단',()=>assert.throws(()=>validateCatalog(change(d=>d.features[1].id=d.features[0].id),root)));
test('예시 데이터를 실제 화면으로 오해하지 않게 캡션 검증',()=>assert.throws(()=>validateCatalog(change(d=>{d.features[0].screen.kind='source';d.features[0].screen.caption='실제 청구내역';}),root)));
test('필수 조치 단계와 처리 유형 검증',()=>{assert.throws(()=>validateCatalog(change(d=>d.features[0].steps=[]),root));assert.throws(()=>validateCatalog(change(d=>d.features[0].availability.mode='guaranteed'),root));});
test('정적 배포에 외부 패키지와 서버 프레임워크 미포함',()=>{const pkg=require('../package.json');assert.deepEqual(Object.keys(pkg.dependencies||{}),[]);assert.deepEqual(Object.keys(pkg.devDependencies||{}),[]);});
test('Vercel의 엄격한 보안 헤더',()=>{const v=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));const headers=new Map(v.headers[0].headers.map(h=>[h.key,h.value]));assert(headers.get('Content-Security-Policy').includes("script-src 'self'"));assert(!headers.get('Content-Security-Policy').includes('unsafe-inline'));assert.equal(headers.get('X-Content-Type-Options'),'nosniff');});
