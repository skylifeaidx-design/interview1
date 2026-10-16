const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {loadCatalog}=require('./catalog.cjs');
const root=path.resolve(__dirname,'..');

function validateCatalog(catalog, projectRoot=root) {
  assert(Array.isArray(catalog.features)&&catalog.features.length>0,'기능 목록이 비어 있습니다.');
  const ids=new Set();
  for(const f of catalog.features) {
    const at=`[${f.id||'알 수 없는 기능'}]`;
    assert(/^f-[a-f0-9]{10}$/.test(f.id),`${at} 기능 ID 형식이 잘못되었습니다.`);
    assert(!ids.has(f.id),`${at} 중복 기능 ID입니다.`);ids.add(f.id);
    for(const key of ['title','major','middle','minor','summary','note','script','route','product','action'])assert(typeof f[key]==='string'&&f[key].trim(),`${at} ${key} 항목을 입력해주세요.`);
    assert(typeof f.login==='boolean'&&typeof f.external==='boolean',`${at} 로그인·외부 서비스 조건은 true 또는 false여야 합니다.`);
    for(const key of ['aliases','menu','steps'])assert(Array.isArray(f[key])&&f[key].every(x=>typeof x==='string'&&x.trim()),`${at} ${key} 목록을 확인해주세요.`);
    assert(f.steps.length>=3,`${at} 조치 순서는 최소 세 단계입니다.`);
    const url=new URL(f.url);
    assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&catalog.allowedHosts.includes(url.hostname),`${at} 허용된 HTTPS 홈페이지 주소만 사용할 수 있습니다.`);
    assert(['action','lookup','guide','external'].includes(f.availability?.mode),`${at} 처리 유형을 확인해주세요.`);
    assert(/^\d{4}-\d{2}-\d{2}$/.test(f.availability.reviewedAt),`${at} 확인 기준일을 입력해주세요.`);
    assert(['live','authenticated','source','login'].includes(f.screen?.kind),`${at} 화면의 실제 캡처·소스 예시 구분을 확인해주세요.`);
    assert(/^screens\/[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png)$/.test(f.screen.src),`${at} 화면 파일 경로가 잘못되었습니다.`);
    const filename=path.resolve(projectRoot,'public',f.screen.src);
    assert(filename.startsWith(path.resolve(projectRoot,'public/screens')+path.sep)&&fs.statSync(filename).isFile(),`${at} 화면 파일이 없습니다.`);
    assert(f.screen.kind!=='source'||/가상|예시/.test(f.screen.caption),`${at} 소스 기반 화면은 예시 데이터임을 표시해주세요.`);
    if(f.screen.url){const screenUrl=new URL(f.screen.url);assert(screenUrl.protocol==='https:'&&!screenUrl.username&&!screenUrl.password&&!screenUrl.port&&catalog.allowedHosts.includes(screenUrl.hostname),`${at} 화면 주소가 허용 도메인에 없습니다.`);}
  }
  return {features:ids.size,categories:new Set(catalog.features.map(f=>f.major)).size};
}

function validateProject(projectRoot=root) {
  const pkg=JSON.parse(fs.readFileSync(path.join(projectRoot,'package.json'),'utf8'));
  assert.deepEqual(pkg.dependencies,{'@vercel/blob':'2.8.2'},'공유 파일 저장용 Vercel Blob SDK만 허용됩니다.');
  assert(!Object.keys(pkg.devDependencies||{}).length,'불필요한 개발 의존성을 포함하지 않습니다.');
  const catalog=loadCatalog(projectRoot);
  const result=validateCatalog(catalog,projectRoot);
  const dictionary=JSON.parse(fs.readFileSync(path.join(projectRoot,'content/search-dictionary.json'),'utf8'));
  assert(dictionary&&typeof dictionary==='object'&&!Array.isArray(dictionary),'검색 사전을 확인해주세요.');
  const samples=JSON.parse(fs.readFileSync(path.join(projectRoot,'content/qna-samples.json'),'utf8'));
  require('../server/qna-publication.cjs').preparePublication(samples);
  assert(samples.questions.length>=100&&samples.questions.length<=120,'검토된 QnA 샘플은 100~120개여야 합니다.');
  const sampleTitles=new Set(),featureIds=new Set(catalog.features.map(f=>f.id));
  const officialHosts=new Set(['www.skylife.co.kr','www.bworld.co.kr','mapp.ktmmobile.com','www.sk7mobile.com','support.uplusumobile.com','mcp.ktmmobile.com','ermsweb.kt.com','www.ktmmobile.com','login.kt.com','www.lguplus.com','speed.nia.or.kr','www.nia.or.kr','help.kt.com','m.help.kt.com','www.kt.com']);
  for(const q of samples.questions){
    assert(!sampleTitles.has(q.title),'샘플 질문 제목이 중복됩니다.');sampleTitles.add(q.title);
    assert(q.body.includes('샘플 질문')&&q.answer.includes('샘플 답변')&&!q.answer.includes('\\n'),'샘플 표시와 문단 구분을 확인해주세요.');
    assert(Array.isArray(q.featureIds)&&q.featureIds.length&&q.featureIds.every(id=>featureIds.has(id)),'샘플이 연결한 실제 기능 ID를 확인해주세요.');
    assert(Array.isArray(q.sourceFiles)&&q.sourceFiles.length&&q.sourceFiles.every(s=>/^(app|components|constants|service|hooks|config|store|lib|utils)\//.test(s.file)&&!s.file.split('/').includes('..')&&Number.isInteger(s.line)&&s.line>0&&/^[a-f0-9]{64}$/.test(s.sha256)),'샘플의 실제 소스 근거를 확인해주세요.');
    assert(Array.isArray(q.sourceEvidence)&&q.sourceEvidence.length,'샘플의 공식 URL 근거가 필요합니다.');
    for(const e of q.sourceEvidence){const url=new URL(e.url);assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&officialHosts.has(url.hostname),'샘플 근거는 검토한 공식 HTTPS 출처여야 합니다.');}
  }
  for(const file of ['src/index.html','src/app.js','src/styles.css','src/search.js','src/qna.js','src/qna.css','src/qna-search.js','api/qna.js'])assert(fs.statSync(path.join(projectRoot,file)).isFile(),`원본 파일이 없습니다: ${file}`);
  const html=fs.readFileSync(path.join(projectRoot,'src/index.html'),'utf8');
  assert(!/<script\b[^>]*>\s*[^<\s]/i.test(html),'HTML 내부 스크립트 대신 분리된 JS 파일을 사용해주세요.');
  assert(!/\son\w+\s*=|\sstyle\s*=/i.test(html),'HTML 인라인 이벤트·스타일을 제거해주세요.');
  const config=JSON.parse(fs.readFileSync(path.join(projectRoot,'vercel.json'),'utf8'));
  assert(config.outputDirectory==='dist'&&config.buildCommand==='npm run build','Vercel 빌드 경로를 확인해주세요.');
  for(const denied of ['.env','credentials.json','token.json'])assert(!fs.existsSync(path.join(projectRoot,'public',denied)),`배포 에셋에 비밀 파일이 있습니다: ${denied}`);
  return {...result,qnaSamples:samples.questions.length,qnaRevision:samples.revision};
}

module.exports={validateCatalog,validateProject};
if(require.main===module){try{console.log(JSON.stringify({검증:'통과',...validateProject()}));}catch(error){console.error('콘텐츠 검증 실패: '+error.message);process.exitCode=1;}}
