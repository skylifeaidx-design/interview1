const crypto = require('node:crypto');
const {createQnaService,QnaError,QnaStoreConflictError,DEFAULT_LIMITS,emptySnapshot,checkedSnapshot,normalizeCommand}=require('./qna-service.cjs');
const AUTHOR='가이드북 샘플';
function stableUUID(value){const bytes=crypto.createHash('sha256').update(value).digest().subarray(0,16);bytes[6]=(bytes[6]&15)|0x50;bytes[8]=(bytes[8]&63)|0x80;const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;}
function preparePublication(manifest){
 if(!manifest||manifest.schemaVersion!==1||!Number.isSafeInteger(manifest.revision)||manifest.revision<1||!/^skylife-[a-z0-9-]{1,80}$/.test(manifest.publicationId||'')||!/^\d{4}-\d{2}-\d{2}$/.test(manifest.reviewedAt||'')||!Array.isArray(manifest.questions)||!manifest.questions.length||manifest.questions.length>150)throw new QnaError(503,'SAMPLES_INVALID','검토된 샘플 내용을 준비하고 있습니다.');
 const keys=new Set();
 const questions=manifest.questions.map(item=>{
  if(!item||!/^[a-z][a-z0-9-]{2,79}$/.test(item.key||'')||keys.has(item.key))throw new QnaError(503,'SAMPLES_INVALID','샘플 식별자를 확인하고 있습니다.');keys.add(item.key);
  const uuid=stableUUID(manifest.publicationId+':question:'+item.key),answerUUID=stableUUID(manifest.publicationId+':answer:'+item.key);
  const question=normalizeCommand({action:'create-question',requestId:uuid,question:{title:item.title,body:item.body,category:item.category,tags:item.tags,author:AUTHOR}},DEFAULT_LIMITS).question;
  const answer=normalizeCommand({action:'create-answer',requestId:answerUUID,questionId:'q-'+uuid,answer:{body:item.answer,author:AUTHOR}},DEFAULT_LIMITS).answer;
  if(!question.body||!answer.body)throw new QnaError(503,'SAMPLES_INVALID','샘플 질문과 답변을 확인하고 있습니다.');
  return {key:item.key,id:'q-'+uuid,answerId:'a-'+answerUUID,question,answer};
 });
 return {id:manifest.publicationId,revision:manifest.revision,reviewedAt:manifest.reviewedAt,questions,digest:crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')};
}
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
function mergePublication(snapshot,publication,at){
 const previous=snapshot.samplePublications?.[publication.id];
 if(previous?.revision>publication.revision)return false;
 if(previous?.digest===publication.digest)return false;
 if(previous?.revision===publication.revision)throw new QnaError(503,'SAMPLE_REVISION_CONFLICT','샘플 개정 번호를 확인하고 있습니다.');
 const marker=key=>({publicationId:publication.id,key,reviewedAt:publication.reviewedAt});
 for(const item of publication.questions){
  let question=snapshot.questions.find(q=>q.id===item.id);
  if(question&&(!question.managedSample||question.managedSample.publicationId!==publication.id||question.managedSample.key!==item.key))throw new QnaError(409,'SAMPLE_ID_CONFLICT','기존 질문과 샘플 식별자가 충돌해 게시를 중단했습니다.');
  if(!question){
   if(snapshot.questions.length>=DEFAULT_LIMITS.questions)throw new QnaError(409,'QUESTION_LIMIT','공유 질문 공간을 확인한 뒤 샘플을 게시해주세요.');
   question={id:item.id,...item.question,ownerHash:crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),createdAt:at,updatedAt:at,version:1,answers:[],managedSample:marker(item.key)};
   snapshot.questions.push(question);
  }else{
   const current=Object.fromEntries(Object.keys(item.question).map(key=>[key,question[key]]));
   if(!same(current,item.question)){Object.assign(question,item.question,{updatedAt:at,version:question.version+1});}
   question.managedSample=marker(item.key);
  }
  let answer=question.answers.find(a=>a.id===item.answerId);
  if(answer&&(!answer.managedSample||answer.managedSample.publicationId!==publication.id||answer.managedSample.key!==item.key))throw new QnaError(409,'SAMPLE_ID_CONFLICT','기존 답변과 샘플 식별자가 충돌해 게시를 중단했습니다.');
  if(!answer){
   if(question.answers.length>=DEFAULT_LIMITS.answers)throw new QnaError(409,'ANSWER_LIMIT','답변 공간을 확인한 뒤 샘플을 게시해주세요.');
   question.answers.unshift({id:item.answerId,...item.answer,ownerHash:crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex'),createdAt:at,updatedAt:at,version:1,managedSample:marker(item.key)});
  }else if(!same({body:answer.body,author:answer.author},item.answer)){
   Object.assign(answer,item.answer,{updatedAt:at,version:answer.version+1,managedSample:marker(item.key)});question.updatedAt=at;
  }
 }
 snapshot.samplePublications={...(snapshot.samplePublications||{}),[publication.id]:{revision:publication.revision,digest:publication.digest,count:publication.questions.length,at,reviewedAt:publication.reviewedAt}};
 return true;
}
function createPublishedQnaService({store,env=process.env,manifest,publish=env.VERCEL_ENV==='production',now=Date.now}={}){
 const base=createQnaService({store,now});let ready,retryAfter=0;
 let publicationState;
 async function publishReviewedSamples(){
  if(!publish||!base.isConfigured())return;
  if(now()<retryAfter)return;
  if(!ready)ready=(async()=>{
   const publication=preparePublication(manifest||require('../content/qna-samples.json'));
   for(let attempt=0;attempt<DEFAULT_LIMITS.retries;attempt++){
    const current=await store.read();
    const snapshot=current?checkedSnapshot(current.value,DEFAULT_LIMITS):emptySnapshot();
    if(current&&(typeof current.etag!=='string'||!current.etag))throw new QnaError(503,'STORAGE_INVALID','공유 저장 버전을 확인하고 있습니다.');
    if(!mergePublication(snapshot,publication,new Date(now()).toISOString()))return;
    if(Buffer.byteLength(JSON.stringify(snapshot),'utf8')>DEFAULT_LIMITS.snapshotBytes)throw new QnaError(413,'STORAGE_SIZE_LIMIT','샘플을 게시할 공유 저장 공간이 부족합니다.');
    try{await store.write(snapshot,current?{ifMatch:current.etag}:{createOnly:true});return;}
    catch(error){if(error instanceof QnaStoreConflictError)continue;throw error;}
   }
   throw new QnaError(409,'WRITE_CONFLICT','다른 저장 요청을 확인한 뒤 샘플을 다시 게시합니다.');
  })();
  try{await ready;publicationState={status:'ready'};}
  catch(error){ready=null;retryAfter=now()+60000;publicationState={status:'pending',message:'검토된 샘플 일부를 준비 중입니다. 기존 질문과 답변은 계속 이용할 수 있습니다.'};}
 }
 return {isConfigured:base.isConfigured,async read(){await publishReviewedSamples();const result=await base.read();return publicationState?.status==='pending'?{...result,samplePublication:publicationState}:result;},async mutate(command,context){await publishReviewedSamples();return base.mutate(command,context);}};
}
module.exports={createPublishedQnaService,preparePublication,mergePublication,stableUUID};
