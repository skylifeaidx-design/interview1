const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createMemoryStore,createQnaService,QnaStoreConflictError,DEFAULT_LIMITS}=require('../server/qna-service.cjs');
const {createPublishedQnaService,preparePublication,stableUUID}=require('../server/qna-publication.cjs');
const manifest=(title='이전 설치는 어떻게 신청하나요?')=>({schemaVersion:1,publicationId:'skylife-unit-samples',revision:1,reviewedAt:'2026-10-16',questions:[{key:'moving-consultation',title,body:'이사할 때 안내받을 메뉴가 궁금합니다. 샘플 질문입니다.',answer:'로그인 후 이전설치 상담 신청 메뉴에서 접수할 수 있습니다. 일정 확정은 별도 확인해주세요.',category:'이용·변경',tags:['이사','이전설치']}]});
const owner=()=>crypto.randomBytes(32).toString('base64url');
const command=()=>({action:'create-question',requestId:crypto.randomUUID(),question:{title:'직접 작성한 질문',body:'기존 문의를 보존해주세요.'}});
test('검토된 샘플을 공유 파일에 한 번만 게시하고 기존 사용자 질문·답변을 보존한다',async()=>{
 const store=createMemoryStore(),base=createQnaService({store}),key=owner(),original=(await base.mutate(command(),{ownerKey:key})).question;
 const service=createPublishedQnaService({store,manifest:manifest(),env:{VERCEL_ENV:'production'}});
 let result=await service.read();assert.equal(result.questions.length,2);assert.deepEqual(result.questions.find(q=>q.id===original.id),original);
 const sample=result.questions.find(q=>q.author==='가이드북 샘플');assert.equal(sample.answers[0].author,'가이드북 샘플');
 const first=store.inspect();await service.read();assert.deepEqual(store.inspect(),first);
 assert(!JSON.stringify(result).includes('ownerHash'));assert(!JSON.stringify(result).includes('managedSample'));assert(!JSON.stringify(result).includes('samplePublications'));
 const other=createPublishedQnaService({store,manifest:manifest(),env:{VERCEL_ENV:'production'}});assert.equal((await other.read()).questions.length,2);
});
test('Preview와 일반 로컬 실행에서는 샘플을 게시하지 않는다',async()=>{
 for(const env of [{VERCEL_ENV:'preview'},{}]){const store=createMemoryStore(),service=createPublishedQnaService({store,manifest:manifest(),env});assert.deepEqual(await service.read(),{questions:[]});assert.equal(store.inspect(),null);}
});
test('샘플 질문에도 누구나 답변할 수 있으며 게시 원고 갱신은 사용자 답변을 보존한다',async()=>{
 const store=createMemoryStore(),first=createPublishedQnaService({store,manifest:manifest(),publish:true});
 const q=(await first.read()).questions[0],key=owner(),answer=await first.mutate({action:'create-answer',requestId:crypto.randomUUID(),questionId:q.id,answer:{body:'참여자가 추가한 안내입니다.'}},{ownerKey:key});
 const id=answer.createdAnswerId,updated=manifest('이사 전 이전설치 상담은 어디서 신청하나요?');updated.revision=2;updated.questions[0].answer='이전설치 상담 접수로 안내합니다. 실제 일정은 별도 확인합니다.';
 const second=createPublishedQnaService({store,manifest:updated,publish:true});const changed=(await second.read()).questions[0];
 assert.equal(changed.version,2);assert.equal(changed.answers.length,2);assert(changed.answers.some(a=>a.id===id));
 await second.mutate({action:'update-answer',questionId:q.id,answerId:id,expectedVersion:1,answer:{body:'참여자 본인 수정'}},{ownerKey:key});
 assert.equal((await second.read()).questions[0].answers.find(a=>a.id===id).version,2);
});
test('여러 서버의 최초 게시 경쟁도 동일한 샘플을 중복 생성하지 않는다',async()=>{
 const store=createMemoryStore(),services=Array.from({length:4},()=>createPublishedQnaService({store,manifest:manifest(),publish:true}));
 const results=await Promise.all(services.map(s=>s.read()));assert(results.every(r=>r.questions.length===1));assert.equal(store.inspect().questions.length,1);
});
test('샘플 게시 중 등록된 일반 사용자 질문도 CAS 재조회 후 함께 보존한다',async()=>{
 let inserted=false,base;
 const store=createMemoryStore({beforeWrite:async next=>{if(next.samplePublications&&!inserted){inserted=true;await base.mutate(command(),{ownerKey:owner()});}}});
 base=createQnaService({store});
 const result=await createPublishedQnaService({store,manifest:manifest(),publish:true}).read();
 assert.equal(result.questions.length,2);assert(result.questions.some(q=>q.author==='가이드북 샘플'));assert(result.questions.some(q=>q.title==='직접 작성한 질문'));
});
test('신뢰된 원고의 ID와 사용자 ID가 충돌하면 사용자 글을 덮어쓰지 않는다',async()=>{
 const store=createMemoryStore(),base=createQnaService({store}),publication=preparePublication(manifest()),input=command();input.requestId=publication.questions[0].id.slice(2);
 await base.mutate(input,{ownerKey:owner()});const before=store.inspect(),service=createPublishedQnaService({store,manifest:manifest(),publish:true});
 const result=await service.read();assert.equal(result.samplePublication.status,'pending');assert.equal(result.questions.length,1);assert.deepEqual(store.inspect(),before);
});
test('샘플 내용도 일반 작성과 같은 개인정보·길이·중복 키 검증을 거친다',()=>{
 const duplicate=manifest();duplicate.questions.push({...duplicate.questions[0]});assert.throws(()=>preparePublication(duplicate));
 const privateData=manifest();privateData.questions[0].answer='개인 전화 010-1234-5678';assert.throws(()=>preparePublication(privateData),e=>e.code==='PERSONAL_INFORMATION');
 const long=manifest();long.questions[0].answer='가'.repeat(4001);assert.throws(()=>preparePublication(long));
 assert.equal(stableUUID('fixed-key'),stableUUID('fixed-key'));assert.notEqual(stableUUID('fixed-key'),stableUUID('other-key'));
});
test('파일 용량 또는 질문 한도를 초과하는 샘플 묶음은 부분 게시하지 않는다',async()=>{
 const store=createMemoryStore(),base=createQnaService({store});
 const current=[];for(let n=0;n<DEFAULT_LIMITS.questions;n++)current.push({id:'q-'+crypto.randomUUID(),title:'기존 질문',body:'유지',category:'기타',tags:[],author:'참여자',ownerHash:'a'.repeat(64),createdAt:'2026-10-16T00:00:00Z',updatedAt:'2026-10-16T00:00:00Z',version:1,answers:[]});
 const full=createMemoryStore({initial:{schemaVersion:1,questions:current,audit:[],rates:[],rateSalt:owner()}}),before=full.inspect();
 const result=await createPublishedQnaService({store:full,manifest:manifest(),publish:true}).read();assert.equal(result.questions.length,DEFAULT_LIMITS.questions);assert.equal(result.samplePublication.status,'pending');assert.deepEqual(full.inspect(),before);
});
test('이전 배포의 cold start가 최신 샘플 원고를 되돌리지 않는다',async()=>{
 const store=createMemoryStore(),old=manifest(),latest=manifest('최신 검토한 이전설치 상담 방법');latest.revision=2;
 await createPublishedQnaService({store,manifest:old,publish:true}).read();
 await createPublishedQnaService({store,manifest:latest,publish:true}).read();const before=store.inspect();
 const result=await createPublishedQnaService({store,manifest:old,publish:true}).read();assert.equal(result.questions[0].title,latest.questions[0].title);assert.deepEqual(store.inspect(),before);
});
test('동일 개정 번호의 서로 다른 원고는 기존 내용을 유지하며 조회와 일반 수정을 허용한다',async()=>{
 const store=createMemoryStore(),old=manifest();await createPublishedQnaService({store,manifest:old,publish:true}).read();
 const bad=manifest('개정 번호를 올리지 않은 변경'),service=createPublishedQnaService({store,manifest:bad,publish:true});
 const results=await Promise.all([service.read(),service.read()]);assert(results.every(r=>r.samplePublication.status==='pending'));assert(results.every(r=>r.questions[0].title===old.questions[0].title));
 const result=await service.mutate(command(),{ownerKey:owner()});assert.equal(result.question.title,'직접 작성한 질문');
});
