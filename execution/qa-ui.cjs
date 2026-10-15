// Optional local QA dependency; never required by the production build.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs');
const path=require('node:path');

const project=path.resolve(__dirname,'..');
const base=process.env.GUIDE_TEST_URL||'http://127.0.0.1:4180/';
const origin=new URL(base).origin;
const artifact=path.join(project,'.tmp','ui-qa');
fs.mkdirSync(artifact,{recursive:true});
const fixture=JSON.parse(fs.readFileSync(path.join(project,'dist','data.json'),'utf8'));
const ids=new Set(fixture.features.map(f=>f.id));

(async()=>{
 let browser,page,phase='web';
 const results=[],errors=[],cspErrors=[],blocked=[],requests=[];
 const assert=(condition,name,detail)=>{results.push({name,pass:!!condition,...(detail===undefined?{}:{detail})});if(!condition)throw Error(name);};
 const check=async(name,run)=>{try{await run();}catch(error){if(!results.length||results.at(-1).pass)results.push({name,pass:false,detail:error.message});}};
 const search=async q=>{await page.locator('#search').fill(q);await page.locator('#search-form button[type="submit"]').click();await page.waitForTimeout(230);};
 const titles=()=>page.locator('.card h3').allTextContents();
 const reset=async()=>{
  for(const id of ['image-dialog','about-dialog'])if(await page.locator('#'+id).evaluate(n=>n.open))await page.locator('#'+id).evaluate(n=>n.close());
  if(await page.locator('#guide-dialog').evaluate(n=>n.open))await page.locator('#guide-close').click();
  await page.locator('#reset').click();
 };
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1100},locale:'ko-KR',acceptDownloads:true});
  await context.route('**/*',async route=>{
   const value=route.request().url();const url=new URL(value);
   if(url.origin===origin){await route.continue();return;}
   blocked.push(value);await route.abort('blockedbyclient');
  });
  await context.addInitScript(()=>{
   window.__qaCopies=[];window.__qaPrintCalls=0;
   Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('QA: fallback required');}}});
   const original=document.execCommand.bind(document);
   document.execCommand=function(command,...args){const value=document.activeElement?.value;const result=original(command,...args);if(command==='copy')window.__qaCopies.push({value,result});return result;};
   window.print=()=>{window.__qaPrintCalls++;};
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push({phase,message:e.message}));
  page.on('console',m=>{if(m.type()==='error'&&/content security|violates|refused to/i.test(m.text()))cspErrors.push({phase,message:m.text()});});
  page.on('request',r=>{requests.push(r.url());});
  const response=await page.goto(base,{waitUntil:'load'});await page.locator('.card').first().waitFor({timeout:20000});
  assert(response.ok(),'엄격 CSP 미리보기 정상 응답');
  assert(response.headers()['content-security-policy']?.includes("script-src 'self'"),'웹 응답에 엄격한 script-src CSP');
  assert(await page.locator('.card').count()===98,'전체 98개 초기 목록');
  assert((await page.title()).includes('홈페이지 기능 가이드북')&&(await page.locator('.brand').innerText()).includes('홈페이지 기능 가이드북'),'변경된 가이드북 제목');
  assert(await page.locator('#download-html,a[download]').count()===0,'HTML 저장 링크 제거');
  assert(await page.evaluate(async()=> (await fetch('skylife-counselor-guide.html',{method:'HEAD',cache:'no-store'})).status())===404,'기존 HTML 다운로드 경로 제거');
  assert(await page.locator('.scenario-grid button').count()===4,'이사·요금·장애·개통 빠른 시나리오');
  assert(await page.locator('.brand img').evaluate(n=>n.complete&&n.naturalWidth>0),'브랜드 로고 표시');
  assert(await page.evaluate(()=>parseFloat(getComputedStyle(document.querySelector('.card p')).fontSize)>=14&&parseFloat(getComputedStyle(document.querySelector('.card-category')).fontSize)>=13),'카드 본문14px 및 분류13px 읽기 크기');
  await page.screenshot({path:path.join(artifact,'desktop.png')});

  await check('스마트 검색과 개인정보 경계',async()=>{
   const cases=[['이사','설치주소 변경 신청'],['돈 내기','요금 조회·납부'],['TV 안 나옴','A/S 자가진단'],['데이터 남았어','모바일 실시간 이용량/요금조회'],['비번','비밀번호 찾기·재설정'],['ㅊㄱㅇㄱ','청구요금 조회'],['요금재','모바일 요금제 예약·변경'],['이사했는데 TV 설치 주소를 바꾸고 싶어요','설치주소 변경 신청']];
   for(const [q,title]of cases){await search(q);assert((await titles()).includes(title),'스마트 검색: '+q);assert(!page.url().includes('q=')&&!page.url().includes(encodeURIComponent(q)),'검색어 URL 미기록: '+q);}
   assert(await page.locator('.match-reason').count()>0,'검색 결과의 연결 이유 표시');
   await search('요금');assert(await page.locator('.card mark').count()>0,'검색 일치 단어 강조');
   await search('개인_검색_검증_4821');
   const stored=await page.evaluate(()=>Object.values({...localStorage}).join(' '));
   assert(!stored.includes('개인_검색_검증_4821'),'자유문장 검색어 localStorage 미저장');
   assert(await page.locator('#search').getAttribute('maxlength')==='500','검색 입력500자 제한');
  });
  await check('자동완성 키보드와 클릭',async()=>{
   await reset();await page.locator('#search').fill('요금');await page.locator('#search-suggestions').waitFor({state:'visible'});
   const first=await page.locator('#search-suggestions [role="option"]').first().locator('span').innerText();
   await page.locator('#search').press('ArrowDown');
   assert(await page.locator('#search').getAttribute('aria-activedescendant')==='suggestion-0','자동완성 방향키 선택');
   await page.locator('#search').press('Enter');await page.waitForTimeout(240);
   assert(await page.locator('#search').inputValue()===first&&!(await page.locator('#search-suggestions').isVisible()),'자동완성 Enter 선택 후 목록 닫힘');
   await page.locator('#search').fill('이사');await page.locator('#search-suggestions').waitFor({state:'visible'});
   await page.locator('#search-suggestions [role="option"]').first().click();await page.waitForTimeout(240);
   assert(!(await page.locator('#search-suggestions').isVisible()),'자동완성 클릭 후 재열림과 지연검색 없음');
  });
  await check('대중소 및 상담 조건 필터',async()=>{
   await reset();await page.locator('[data-major="요금·납부"]').click();
   assert(await page.locator('.card').count()>0&&(await page.locator('.card-category').allTextContents()).every(v=>v.includes('요금·납부')),'대분류 필터');
   await page.selectOption('#middle-filter','요금 조회');await page.selectOption('#minor-filter','청구요금 조회');
   assert(await page.locator('.card').count()===1&&(await titles())[0]==='청구요금 조회','중·소분류 필터');
   await search('TV 안 나옴');assert(await page.locator('#empty-state').isVisible(),'활성 필터 안의0건 안내');
   await page.locator('[data-widen]').click();
   assert(await page.locator('#search').inputValue()==='TV 안 나옴'&&(await titles()).includes('A/S 자가진단')&&await page.locator('.active-chip').count()===0,'검색어를 유지하고 범위 복구');
   await reset();await page.selectOption('#product-filter','모바일');
   const products=await page.locator('.card .pill.product').allTextContents();
   assert(products.length>0&&products.every(v=>v==='공통'||v.split('·').includes('모바일')),'대상 상품은 공통 기능을 포함');
   await reset();await page.selectOption('#login-filter','required');
   assert(await page.locator('.card').count()===fixture.features.filter(f=>f.login).length,'로그인 필요 조건');
   await page.selectOption('#login-filter','public');
   assert(await page.locator('.card').count()===fixture.features.filter(f=>!f.login).length,'로그인 외 진입 조건');
   await reset();await page.selectOption('#availability-filter','action');
   assert(await page.locator('.card').count()===fixture.features.filter(f=>f.availability.mode==='action').length,'처리 유형 신청·변경 필터');
   await reset();await page.locator('[data-action="납부"]').click();
   assert(await page.locator('.card').count()>0&&(await titles()).includes('요금 조회·납부'),'실제 action의 문의 목적 납부');
   await reset();await page.selectOption('#sort','name');const actual=await titles();
   assert(JSON.stringify(actual)===JSON.stringify([...actual].sort((a,b)=>a.localeCompare(b,'ko'))),'이름순 정렬');
  });
  await check('저장·최근 기록·키보드 탭',async()=>{
   await reset();const id=await page.locator('.bookmark').first().getAttribute('data-save');await page.locator('.bookmark').first().click();
   await page.locator('#tab-saved').click();assert(await page.locator('.card').count()===1,'즐겨찾기 보기');
   await page.reload();await page.locator('.card').first().waitFor();await page.locator('#tab-saved').click();
   assert(await page.locator('.card').count()===1&&await page.locator('.bookmark').getAttribute('data-save')===id,'즐겨찾기 새로고침 유지');
   await page.locator('.card-open').first().click();await page.locator('#guide-close').click();await page.locator('#tab-recent').click();
   assert(await page.locator('.card').count()===1,'최근 본 기능 접근');
   await page.locator('#tab-recent').press('ArrowLeft');assert(await page.locator('#tab-saved').getAttribute('aria-selected')==='true','탭 방향키 이동');
   const data=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([key])=>key.startsWith('skylife-guide:')).map(([k,v])=>[k,JSON.parse(v)])));
   assert(Object.values(data).every(values=>Array.isArray(values)&&values.every(id=>ids.has(id))),'저장소에는 기능ID만 보관');
  });
  await check('상세·복사·직접 공유·전체 확대·인쇄',async()=>{
   await reset();await page.locator('.card-open').first().click();
   assert(await page.locator('#guide-dialog').isVisible()&&await page.locator('.steps li').count()>=3,'상세 고객 조치 순서');
   assert((await page.locator('.guide-meta').innerText()).includes('청구요금 조회')&&(await page.locator('.screen-kind').innerText()).includes('소스 기반'),'소분류 및 실제 화면/소스 예시 구분');
   const script=await page.locator('.script-box').innerText();await page.locator('#copy-script').click();const copied=await page.evaluate(()=>window.__qaCopies.at(-1));
   assert(copied?.result&&copied.value===script,'모달 내부 안내 문구 복사 fallback');
   await page.locator('#copy-path').click();const copiedPath=await page.evaluate(()=>window.__qaCopies.at(-1));
   assert(copiedPath?.result&&copiedPath.value.includes(' → '),'메뉴 경로 복사');
   await page.locator('#share-guide').click();const shared=await page.evaluate(()=>window.__qaCopies.at(-1));const direct=new URL(shared.value);
   assert(shared.result&&direct.origin===origin&&!direct.search&&/^#guide=f-/.test(direct.hash),'공유 링크는 현재 배포 주소와 기능ID만 포함');
   await page.locator('#zoom-button').click();await page.locator('#zoom-image').evaluate(n=>n.complete?Promise.resolve():new Promise(resolve=>n.addEventListener('load',resolve,{once:true})));
   assert(await page.locator('#image-dialog').isVisible()&&await page.locator('#zoom-image').evaluate(n=>n.naturalWidth>0),'화면 전체 확대');
   await page.locator('#zoom-fit').click();assert(await page.locator('#zoom-frame').evaluate(n=>n.classList.contains('original')),'원본 크기 확대 전환');
   await page.locator('#zoom-close').click();await page.locator('#print-guide').click();assert(await page.evaluate(()=>window.__qaPrintCalls)===1,'인쇄 동작');
   await page.emulateMedia({media:'print'});assert(await page.locator('#guide-dialog').isVisible()&&!(await page.locator('.workspace').isVisible()),'인쇄 시 선택한 가이드만 표시');await page.emulateMedia({media:'screen'});
   await page.locator('#guide-close').click();await page.goto(direct.href,{waitUntil:'load'});await page.locator('#guide-title').waitFor();
   assert(await page.locator('#guide-dialog').isVisible(),'기능별 직접 링크 진입');await page.keyboard.press('Escape');assert(!(await page.locator('#guide-dialog').isVisible()),'Escape 상세 닫기');
  });
  await check('XSS 방어와 자유문장 URL 비노출',async()=>{
   await reset();const attack='<img src=x onerror="window.__guideXss=1">';await search(attack);
   assert(await page.locator('#result-summary img').count()===0&&await page.locator('[onerror]').count()===0&&!(await page.evaluate(()=>window.__guideXss)),'검색어 HTML 이벤트가 코드로 실행되지 않음');
   assert(!new URL(page.url()).search&&!new URL(page.url()).hash,'자유문장 검색어 query/hash 비노출');
  });
  await check('반응형 및 모바일 반복 사용',async()=>{
   await reset();
   for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(3200);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+'px 목록 가로 넘침 없음');
    assert(await page.locator('#tab-recent').isVisible(),width+'px 최근 본 기능 탭 접근');
    await page.screenshot({path:path.join(artifact,'mobile-'+width+'.png')});
    await page.locator('#mobile-menu').click();assert(await page.locator('#sidebar').evaluate(n=>n.classList.contains('open'))&&await page.locator('.workspace').evaluate(n=>n.inert),'모바일 메뉴 상태와 본문 inert '+width);
    await page.keyboard.press('Escape');await page.waitForTimeout(250);assert(await page.locator('#mobile-menu').getAttribute('aria-expanded')==='false'&&!(await page.locator('.workspace').evaluate(n=>n.inert)),'모바일 Escape 메뉴 닫기 '+width);
    await page.locator('.card-open').first().click();assert(await page.locator('#guide-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth+1),width+'px 상세 가로 넘침 없음');
    if(width===390)await page.screenshot({path:path.join(artifact,'mobile-detail.png')});await page.locator('#guide-close').click();
   }
   await page.setViewportSize({width:1440,height:1100});await page.waitForTimeout(260);await reset();
  });
  await check('실행 보안 및 네트워크',async()=>{
   assert(blocked.length===0,'외부 네트워크 요청 없음',blocked);
   assert(requests.every(value=>!new URL(value).searchParams.has('q')),'요청URL에 검색어 매개변수 없음');
   assert(errors.length===0,'브라우저 실행 오류 없음',errors);
   assert(cspErrors.length===0,'웹 CSP 위반 없음',cspErrors);
  });
 }catch(error){if(!results.length||results.at(-1).pass)results.push({name:'초기화 또는 검증 실행',pass:false,detail:error.message});}
 finally{
  if(browser)await browser.close();
  const report={passed:results.filter(r=>r.pass).length,failed:results.filter(r=>!r.pass).length,results,errors,cspErrors,blocked,requests};
  const reportPath=path.join(artifact,'report.json');fs.writeFileSync(reportPath,JSON.stringify(report,null,2),'utf8');
  console.log(JSON.stringify({passed:report.passed,failed:report.failed,report:reportPath,failures:results.filter(r=>!r.pass),errors,cspErrors,blocked},null,2));
  if(report.failed)process.exitCode=1;
 }
})();
