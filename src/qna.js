/* Shared participant QnA. Content is saved only by the same-origin API. */
(() => {
 'use strict';
 const $=(query,base=document)=>base.querySelector(query),$$=(query,base=document)=>[...base.querySelectorAll(query)];
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const categories=['요금·납부','가입·상품','이용·변경','장애·A/S','문의·고객지원','회원·계정','혜택·콘텐츠','사업자 지원','기타'];
 const ownerKeyName='skylife-qna:owner-key',ownedName='skylife-qna:owned';
 const questionID=value=>typeof value==='string'&&/^q-[a-z0-9-]{1,80}$/i.test(value);
 const answerID=value=>typeof value==='string'&&/^a-[a-z0-9-]{1,80}$/i.test(value);
 const plain=(value,max)=>typeof value==='string'?value.slice(0,max):'';
 const state={initialized:false,open:false,query:'',global:false,questions:[],loading:true,configured:false,canWrite:false,loadError:'',view:'all',category:'',selectedId:null,pending:false,compose:null,editAnswer:null,confirm:null,author:'',storageWarning:''};
 let options={},inflight=null,noticeTimer,threadTrigger=null,composeTrigger=null;
 const visibility=new Map(),requestIds=new Map(),drafts=new Map(),searchCache=new Map();
 const dateFormat=new Intl.DateTimeFormat('ko-KR',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
 let owned=readOwned();
 function readOwned(){try{const data=JSON.parse(localStorage.getItem(ownedName)||'{}');return {questions:Array.isArray(data.questions)?data.questions.filter(questionID):[],answers:Array.isArray(data.answers)?data.answers.filter(answerID):[]};}catch{return {questions:[],answers:[]};}}
 function saveOwned(removed={questions:[],answers:[]}){const current=readOwned();owned={questions:[...new Set([...current.questions,...owned.questions])].filter(id=>!(removed.questions||[]).includes(id)),answers:[...new Set([...current.answers,...owned.answers])].filter(id=>!(removed.answers||[]).includes(id))};try{localStorage.setItem(ownedName,JSON.stringify(owned));}catch{state.storageWarning='공유 저장은 완료됐지만 이 브라우저의 작성 목록 보관이 제한됩니다.';notice(state.storageWarning);}}
 function ownsQuestion(id){return owned.questions.includes(id);}
 function ownsAnswer(id){return owned.answers.includes(id);}
 function mine(q){return ownsQuestion(q.id)||q.answers.some(a=>ownsAnswer(a.id));}
 function normalizeQuestion(value){
  if(!value||!questionID(value.id))return null;
  return {id:value.id,title:plain(value.title,120),body:plain(value.body,4000),category:categories.includes(value.category)?value.category:'기타',tags:Array.isArray(value.tags)?value.tags.filter(v=>typeof v==='string').slice(0,8).map(v=>v.slice(0,24)):[],author:plain(value.author,30)||'익명 참여자',createdAt:plain(value.createdAt,60),updatedAt:plain(value.updatedAt,60),version:Number.isSafeInteger(value.version)?value.version:0,answers:Array.isArray(value.answers)?value.answers.filter(a=>a&&answerID(a.id)).map(a=>({id:a.id,body:plain(a.body,4000),author:plain(a.author,30)||'익명 참여자',createdAt:plain(a.createdAt,60),updatedAt:plain(a.updatedAt,60),version:Number.isSafeInteger(a.version)?a.version:0})):[]};
 }
 function date(value){const parsed=new Date(value);return Number.isFinite(parsed.getTime())?dateFormat.format(parsed):'시간 확인 필요';}
 function timeHTML(value){const parsed=new Date(value);return Number.isFinite(parsed.getTime())?`<time datetime="${esc(parsed.toISOString())}">${esc(date(value))}</time>`:esc('시간 확인 필요');}
 function notice(text){const node=$('#qna-notice'),host=['qna-confirm-dialog','qna-compose-dialog','qna-thread-dialog'].map(id=>$('#'+id)).find(dialog=>dialog.open)||document.body;host.append(node);node.textContent=text;node.classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>node.classList.remove('visible'),3300);}
 function notify(){if(typeof options.onUpdate==='function')options.onUpdate();}
 function randomUUID(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const h=[...bytes].map(n=>n.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
 function ownerKey(){
  let key;try{key=localStorage.getItem(ownerKeyName);}catch{throw Error('이 브라우저에서 수정 권한을 보관할 수 없습니다. 브라우저 저장 설정을 확인해주세요.');}
  if(/^[A-Za-z0-9_-]{43}$/.test(key||''))return key;
  const bytes=crypto.getRandomValues(new Uint8Array(32));key=btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  try{localStorage.setItem(ownerKeyName,key);if(localStorage.getItem(ownerKeyName)!==key)throw Error();}catch{throw Error('이 브라우저에서 수정 권한을 보관할 수 없어 작성할 수 없습니다. 저장 설정을 확인해주세요.');}return key;
 }
 function requestId(key){if(!requestIds.has(key))requestIds.set(key,randomUUID());return requestIds.get(key);}
 function matching(query=state.query){
  const text=String(query).slice(0,500);if(searchCache.has(text))return searchCache.get(text);
  let result;if(window.GuideQnASearch?.search)result=window.GuideQnASearch.search(state.questions,text,options.dictionary||{});
  else {const needle=text.trim().toLocaleLowerCase('ko');result=state.questions.filter(q=>!needle||[q.title,q.body,q.category,...q.tags,...q.answers.map(a=>a.body)].join(' ').toLocaleLowerCase('ko').includes(needle)).map(question=>({question,score:0,matchedTerms:needle?[needle]:[],reason:needle?'질문·답변 내용에서 일치합니다.':''}));}
  if(searchCache.size>=6)searchCache.delete(searchCache.keys().next().value);searchCache.set(text,result);return result;
 }
 function highlight(value,terms=[]){
  const text=String(value??''),lower=text.toLocaleLowerCase('ko'),ranges=[];
  for(const term of [...new Set(terms)].filter(v=>typeof v==='string'&&v.length&&v.length<=100).slice(0,12)){let cursor=0,index;const needle=term.toLocaleLowerCase('ko');while((index=lower.indexOf(needle,cursor))!==-1){ranges.push([index,index+needle.length]);cursor=index+needle.length;}}
  ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
  let output='',cursor=0;for(const [start,end]of merged){output+=esc(text.slice(cursor,start))+'<mark>'+esc(text.slice(start,end))+'</mark>';cursor=end;}return output+esc(text.slice(cursor));
 }
 function excerpt(value,terms=[]){const text=String(value);const lower=text.toLocaleLowerCase('ko');const indices=terms.filter(v=>typeof v==='string'&&v).map(v=>lower.indexOf(v.toLocaleLowerCase('ko'))).filter(v=>v>=0);const start=indices.length?Math.max(0,Math.min(...indices)-35):0;return (start?'…':'')+text.slice(start,start+180)+(text.length>start+180?'…':'');}
 function cardHTML({question:q,matchedTerms=[],reason=''}){
  return `<article class="qna-card" data-qna-question="${esc(q.id)}"><button type="button" class="qna-card-open" data-qna-open="${esc(q.id)}"><div class="qna-card-top"><span class="qna-card-category">${esc(q.category)}${mine(q)?' <span class="qna-mine-badge">내 참여 글</span>':''}</span><span class="qna-answer-state ${q.answers.length?'':'waiting'}">${q.answers.length?'답변 '+q.answers.length+'개':'답변 대기'}</span></div><h3>${highlight(q.title,matchedTerms)}</h3><p class="qna-card-preview">${highlight(excerpt(q.body,matchedTerms),matchedTerms)}</p><div class="qna-card-meta"><span>참여자 ${esc(q.author)}</span><span>작성 ${timeHTML(q.createdAt)}</span>${q.updatedAt&&q.updatedAt!==q.createdAt?'<span>수정됨</span>':''}</div></button>${state.query&&reason?`<p class="qna-card-reason">${esc(reason)}</p>`:''}</article>`;
 }
 function statusText(){
  if(state.loading)return '공유 질문·답변을 불러오고 있습니다.';
  if(!state.configured)return state.loadError||'공유 저장소 연결을 준비하고 있습니다. 연결 후 누구나 질문과 답변을 함께 저장할 수 있습니다.';
  if(state.loadError)return state.loadError+' 최근 불러온 목록을 표시합니다. 새로고침을 다시 시도해주세요.';
  if(!state.canWrite)return '공유 질문·답변을 조회할 수 있습니다. 현재 질문과 답변 작성은 준비 중입니다.';
  return state.storageWarning||'공유 저장소에 연결되었습니다. 질문과 답변은 모든 방문자에게 공개됩니다. 개인정보는 입력하지 마세요.';
 }
 function renderStatus(){
  const node=$('#qna-status');node.classList.toggle('is-pending',!state.loading&&(!state.configured||!state.canWrite));node.classList.toggle('is-error',!!state.loadError&&state.configured);node.textContent=statusText();
  $('#qna-create').disabled=!canWrite();$('#qna-refresh').disabled=state.loading||state.pending;$('#qna-refresh').textContent=state.loading?'불러오는 중…':'새로고침';$('#qna-nav-count').textContent=state.loading?'…':state.configured?state.questions.length:'—';
  $$('[data-qna-write]').forEach(node=>node.disabled=!canWrite());
 }
 function canWrite(){return state.configured&&state.canWrite&&!state.loading&&!state.pending;}
 function renderList(){
  const node=$('#qna-list');node.setAttribute('aria-busy',state.loading);node.setAttribute('aria-labelledby','qna-tab-'+state.view);
  $$('[data-qna-view]',$('#qna-tabs')).forEach(b=>{const active=b.dataset.qnaView===state.view;b.setAttribute('aria-selected',active);b.tabIndex=active?0:-1;});
  const results=matching().filter(({question:q})=>(!state.category||q.category===state.category)&&(state.view!=='waiting'||!q.answers.length)&&(state.view!=='answered'||q.answers.length>0)&&(state.view!=='mine'||mine(q)));
  const query=state.query.length>60?state.query.slice(0,60)+'…':state.query;
  $('#qna-result-summary').textContent=state.query?'‘'+query+'’ 질문·답변 검색 '+results.length+'개':'질문 '+results.length+'개';$('#qna-clear-query').hidden=!state.query;
  if(state.loading&&!state.questions.length){node.innerHTML='<div class="qna-loading">공유 질문을 불러오고 있어요.</div>';return;}
  if(results.length){node.innerHTML=results.map(cardHTML).join('');return;}
  const ready=state.configured&&!state.loadError;
  const title=!ready?'공유 질문을 아직 불러오지 못했어요.':state.query||state.category?'조건에 맞는 질문이 없어요.':state.view==='mine'?'이 브라우저에서 작성한 글이 없어요.':state.view==='waiting'?'현재 답변을 기다리는 질문이 없어요.':state.view==='answered'?'아직 답변이 등록된 질문이 없어요.':'첫 번째 질문을 남겨보세요.';
  const description=!ready?statusText():state.query||state.category?'검색어를 짧게 바꾸거나 분류와 답변 상태의 범위를 넓혀보세요.':state.view==='mine'?'이 브라우저에서 질문이나 답변을 작성하면 모아볼 수 있습니다.':'상담 중 궁금했던 점과 함께 찾은 안내 방법을 나눌 수 있습니다.';
  node.innerHTML=`<div class="qna-empty"><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="qna-empty-actions">${state.query||state.category||state.view!=='all'?'<button type="button" class="secondary-button" data-qna-reset>검색 조건 초기화</button>':''}${canWrite()?'<button type="button" class="qna-primary" data-qna-create>질문 작성</button>':'<button type="button" class="secondary-button" data-qna-refresh>새로고침</button>'}</div></div>`;
 }
 function renderGlobal(){
  const panel=$('#qna-global-results');panel.hidden=state.open||!state.global||!state.query.trim();if(panel.hidden)return;
  const results=matching();$('#qna-global-summary').textContent=state.loading?'참여자 질문·답변을 검색하고 있습니다.':!state.configured||state.loadError?statusText():'질문·답변에서 '+results.length+'개의 관련 질문을 찾았어요.';
  if(state.loading){$('#qna-global-list').innerHTML='<div class="qna-loading">질문·답변 검색 준비 중</div>';return;}
  $('#qna-global-list').innerHTML=results.length?results.slice(0,4).map(cardHTML).join(''):`<div class="qna-empty"><h3>${state.configured&&!state.loadError?'관련된 참여자 질문이 없어요.':'공유 질문·답변 연결 준비 중'}</h3><p>${esc(state.configured&&!state.loadError?'기능 가이드를 확인하거나 QnA에서 새로운 질문을 남길 수 있습니다.':statusText())}</p></div>`;
  $('#qna-global-open').textContent=results.length>4?'QnA 결과 '+results.length+'개 모두 보기 ↗':'QnA 전체 보기 ↗';
 }
 function enforceMode(){if(state.open){for(const node of $$('.intro,.scenario-section,.library'))node.hidden=true;$('#qna-section').hidden=false;}$('#qna-nav').classList.toggle('selected',state.open);$('#qna-nav').setAttribute('aria-expanded',state.open);}
 function render(){if(!state.initialized)return;renderStatus();if(state.open)renderList();renderGlobal();enforceMode();}
 function open(){
  if(!state.open){for(const node of $$('.intro,.scenario-section,.library'))visibility.set(node,node.hidden);state.open=true;if(typeof options.onOpen==='function')options.onOpen();}
  enforceMode();render();$('#qna-title').setAttribute('tabindex','-1');
 }
 function setHash(id){const url=new URL(location.href);url.search='';if(id)url.hash='qna='+id;else if(new URLSearchParams(url.hash.slice(1)).has('qna'))url.hash='';else return;try{history.replaceState(null,'',url.href);}catch{/* file mode remains read-only */}}
 function closeThread(){if(state.pending)return notice('저장 중입니다. 잠시 기다려주세요.');$('#qna-thread-dialog').close();state.selectedId=null;state.editAnswer=null;setHash(null);const target=threadTrigger?.isConnected&&threadTrigger.getClientRects().length?threadTrigger:$('#qna-title');target?.focus({preventScroll:true});threadTrigger=null;}
 function close(){if(state.pending)return false;for(const id of ['qna-confirm-dialog','qna-compose-dialog','qna-thread-dialog'])$('#'+id).close();state.selectedId=null;state.compose=null;state.editAnswer=null;state.confirm=null;setHash(null);if(!state.open)return true;state.open=false;for(const [node,hidden]of visibility)node.hidden=hidden;visibility.clear();$('#qna-section').hidden=true;enforceMode();renderGlobal();return true;}
 function closeDialogs(){if(state.pending){notice('저장 중입니다. 잠시 기다려주세요.');return false;}$('#qna-confirm-dialog').close();state.confirm=null;if($('#qna-compose-dialog').open)closeCompose();if($('#qna-thread-dialog').open)closeThread();return true;}
 function setQuery(query,{showGlobal=false}={}){state.query=String(query??'').slice(0,500);state.global=!!showGlobal;render();}
 function searchFor(query){if(typeof options.onSearch==='function')options.onSearch(String(query).slice(0,500));else{state.query=String(query).slice(0,500);$('#search').value=state.query;render();}}
 function question(id){return state.questions.find(q=>q.id===id);}
 function tagsHTML(tags){return tags.length?`<div class="qna-tag-row">${tags.map(tag=>`<button type="button" data-qna-query="${esc(tag)}">#${esc(tag)}</button>`).join('')}</div>`:'';}
 function errorBox(id){return `<div class="qna-form-error" id="${id}" role="alert" hidden></div>`;}
 const privacy='<p class="qna-privacy-note">모든 방문자에게 공개됩니다. 고객 이름·전화번호·주민등록번호·계약번호 등 개인정보와 계정정보는 입력하지 마세요.</p>';
 function authorField(value,id){return `<label for="${id}">표시 이름 <small>선택 · 미입력 시 익명 참여자</small><input id="${id}" name="author" maxlength="30" value="${esc(value||'')}" autocomplete="off" placeholder="30자 이내"></label>`;}
 function answerFormHTML(q){
  const key='answer:'+q.id,draft=drafts.get(key)||{body:'',author:state.author};
  return `<form class="qna-form" id="qna-answer-form" data-qna-form="create-answer" data-qna-question-id="${esc(q.id)}"><label for="qna-answer-body">답변 내용<input type="hidden" name="questionId" value="${esc(q.id)}"><textarea id="qna-answer-body" name="body" maxlength="4000" required placeholder="확인한 메뉴와 조치 순서를 구체적으로 적어주세요.">${esc(draft.body)}</textarea><small>최대 4,000자 · 공식 답변으로 게시되지 않습니다.</small></label>${authorField(draft.author,'qna-answer-author')}${errorBox('qna-answer-error')}<div class="qna-form-actions"><span class="qna-field-help">수정 권한은 이 브라우저에 보관됩니다.</span><button type="submit" class="qna-primary" data-qna-write>답변 등록</button></div></form>`;
 }
 function answerHTML(q,a){
  if(state.editAnswer?.id===a.id){const draft=drafts.get('edit-answer:'+a.id)||{body:a.body,author:a.author==='익명 참여자'?'':a.author};return `<article class="qna-answer"><p class="qna-answer-author">내 답변 수정</p><form class="qna-form" data-qna-form="update-answer" data-qna-question-id="${esc(q.id)}" data-qna-answer-id="${esc(a.id)}"><label for="qna-edit-answer-body">답변 내용<textarea id="qna-edit-answer-body" name="body" maxlength="4000" required>${esc(draft.body)}</textarea><small>최대 4,000자</small></label>${authorField(draft.author,'qna-edit-answer-author')}${errorBox('qna-edit-answer-error')}<div class="qna-form-actions"><button type="button" class="secondary-button" data-qna-cancel-answer>취소</button><button type="submit" class="qna-primary" data-qna-write>수정 저장</button></div></form></article>`;}
  return `<article class="qna-answer"><div class="qna-answer-meta"><span class="qna-answer-author">참여자 ${esc(a.author)} ${ownsAnswer(a.id)?'<span class="qna-mine-badge">내 답변</span>':''}</span><span>${timeHTML(a.createdAt)}${a.updatedAt&&a.updatedAt!==a.createdAt?' · 수정됨':''}</span></div><p class="qna-answer-text">${esc(a.body)}</p><div class="qna-answer-footer"><span>인증되지 않은 참여자 답변</span>${ownsAnswer(a.id)?`<div><button type="button" class="qna-link-button" data-qna-edit-answer="${esc(a.id)}">수정</button><button type="button" class="qna-link-button danger" data-qna-delete-answer="${esc(a.id)}">삭제</button></div>`:''}</div></article>`;
 }
 function renderThread(){
  const q=question(state.selectedId);if(!q){$('#qna-thread-body').innerHTML=`<header class="qna-dialog-head"><button type="button" class="qna-close" data-qna-close-thread aria-label="질문 닫기">✕</button><span class="qna-source">참여자 작성</span><h2 id="qna-thread-title">질문을 불러오지 못했어요.</h2></header><div class="qna-thread-content"><p class="qna-form-note">${esc(state.loading?'공유 질문을 불러오고 있습니다.':state.loadError||'삭제되었거나 현재 목록에 없는 질문입니다.')}</p><button type="button" class="secondary-button" data-qna-refresh>최신 목록 불러오기</button></div>`;return;}
  $('#qna-thread-body').innerHTML=`<header class="qna-dialog-head"><button type="button" class="qna-close" data-qna-close-thread aria-label="질문 닫기">✕</button><span class="qna-source">참여자 작성 · 공식 가이드 아님</span><h2 id="qna-thread-title">${esc(q.title)}</h2><div class="qna-thread-meta"><span>${esc(q.category)}</span><span>참여자 ${esc(q.author)}</span><span>작성 ${timeHTML(q.createdAt)}</span>${q.updatedAt&&q.updatedAt!==q.createdAt?`<span>수정 ${timeHTML(q.updatedAt)}</span>`:''}</div></header><div class="qna-thread-content"><p class="qna-thread-text">${esc(q.body)}</p>${tagsHTML(q.tags)}<div class="qna-thread-actions"><button type="button" class="qna-link-button" data-qna-share="${esc(q.id)}">질문 링크 복사</button>${ownsQuestion(q.id)?`<button type="button" class="qna-link-button" data-qna-edit-question="${esc(q.id)}" ${!canWrite()?'disabled':''}>내 질문 수정</button><button type="button" class="qna-link-button danger" data-qna-delete-question="${esc(q.id)}" ${!canWrite()||q.answers.length?'disabled':''} ${q.answers.length?'title="답변이 있는 질문은 삭제할 수 없습니다."':''}>삭제</button>`:''}</div>${ownsQuestion(q.id)&&q.answers.length?'<p class="qna-delete-help">다른 참여자의 답변을 보호하기 위해 답변이 있는 질문은 삭제할 수 없습니다.</p>':''}</div><section class="qna-answer-section"><h3>참여자 답변<span>${q.answers.length}</span></h3><div class="qna-answer-list">${q.answers.length?q.answers.map(a=>answerHTML(q,a)).join(''):'<p class="qna-form-note">아직 답변이 없습니다. 확인한 내용을 알고 있다면 첫 답변을 남겨주세요.</p>'}</div></section><section class="qna-write-section"><h3>함께 답변해요</h3><p class="qna-form-note">답변은 인증 없는 참여자 작성 내용입니다. 메뉴와 이용 조건을 확인한 내용만 공유해주세요.</p>${canWrite()?privacy+answerFormHTML(q):`<div class="qna-readonly-note">${esc(statusText())}</div>`}</section>`;
 }
 function openQuestion(id,opener){if(!questionID(id))return;open();if(opener)threadTrigger=opener;state.selectedId=id;state.editAnswer=null;renderThread();if(!$('#qna-thread-dialog').open)$('#qna-thread-dialog').showModal();$('#qna-thread-dialog').scrollTop=0;setHash(id);}
 function questionFields(q){return {title:q?.title||'',body:q?.body||'',category:q?.category||'기타',tags:q?.tags?.join(', ')||'',author:q?.author&&q.author!=='익명 참여자'?q.author:state.author};}
 function openCompose(id,opener){
  if(!canWrite()){notice(statusText());return;}
  const q=id?question(id):null;if(id&&(!q||!ownsQuestion(id)))return;
  composeTrigger=opener||document.activeElement;state.compose={id:id||null,version:q?.version};const key=id?'edit-question:'+id:'question:new',draft=drafts.get(key)||questionFields(q);
  $('#qna-compose-body').innerHTML=`<header class="qna-dialog-head"><button type="button" class="qna-close" data-qna-close-compose aria-label="질문 작성 닫기">✕</button><span class="qna-source">참여자 작성</span><h2 id="qna-compose-title">${id?'내 질문 수정':'질문 작성'}</h2><p>공유 저장소에 등록되며 모든 방문자가 볼 수 있습니다.</p></header><div class="qna-compose-content">${privacy}<form id="qna-question-form" class="qna-form" data-qna-form="${id?'update-question':'create-question'}" ${id?`data-qna-question-id="${esc(id)}"`:''}><label for="qna-question-title">질문 제목<input id="qna-question-title" name="title" maxlength="120" required value="${esc(draft.title)}" placeholder="질문의 핵심을 120자 이내로 적어주세요."></label><div class="qna-form-row"><label for="qna-question-category">분류<select id="qna-question-category" name="category">${categories.map(v=>`<option value="${esc(v)}" ${draft.category===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>${authorField(draft.author,'qna-question-author')}</div><label for="qna-question-body">질문 내용<textarea id="qna-question-body" name="body" maxlength="4000" required placeholder="어떤 상황에서 어떤 안내가 필요한지 적어주세요.">${esc(draft.body)}</textarea><small>최대 4,000자 · 고객의 개인 정보와 계정 정보는 제외해주세요.</small></label><label for="qna-question-tags">관련 태그 <small>선택</small><input id="qna-question-tags" name="tags" maxlength="240" value="${esc(draft.tags)}" placeholder="예: 이사, 이전설치, TV"><small>쉼표로 구분 · 최대 8개 · 태그당 24자</small></label><label class="qna-honeypot" aria-hidden="true">웹사이트<input name="website" tabindex="-1" autocomplete="off"></label>${errorBox('qna-question-error')}<p class="qna-form-note">작성자 수정·삭제 권한은 이 브라우저에만 보관됩니다. 브라우저 기록을 삭제하거나 다른 기기로 바꾸면 권한을 잃을 수 있습니다.</p><div class="qna-form-actions"><button type="button" class="secondary-button" data-qna-close-compose>취소</button><button type="submit" class="qna-primary" data-qna-write>${id?'수정 저장':'질문 등록'}</button></div></form></div>`;
  if(!$('#qna-compose-dialog').open)$('#qna-compose-dialog').showModal();$('#qna-compose-dialog').scrollTop=0;
 }
 function closeCompose(){if(state.pending)return notice('저장 중입니다. 잠시 기다려주세요.');$('#qna-compose-dialog').close();state.compose=null;composeTrigger?.focus({preventScroll:true});composeTrigger=null;}
 function formValues(form){return Object.fromEntries(new FormData(form).entries());}
 function draftKey(form){const kind=form.dataset.qnaForm,id=form.dataset.qnaQuestionId,aid=form.dataset.qnaAnswerId;return kind==='create-question'?'question:new':kind==='update-question'?'edit-question:'+id:kind==='create-answer'?'answer:'+id:'edit-answer:'+aid;}
 function actionKey(form){return form.dataset.qnaForm+':'+(form.dataset.qnaAnswerId||form.dataset.qnaQuestionId||'new');}
 function displayError(node,message){if(!node){notice(message);return;}node.textContent=message;node.hidden=false;node.focus?.({preventScroll:true});}
 function prepareQuestion(values){const tags=[...new Set(String(values.tags||'').split(',').map(v=>v.trim().replace(/^#+/, '')).filter(Boolean))];if(tags.length>8)throw Error('태그는 최대 8개까지 입력할 수 있습니다.');if(tags.some(v=>v.length>24))throw Error('각 태그는 24자 이내로 입력해주세요.');const title=String(values.title||'').trim(),body=String(values.body||'').trim();if(!title||!body)throw Error('질문 제목과 내용을 입력해주세요.');return {title,body,category:categories.includes(values.category)?values.category:'기타',tags,author:String(values.author||'').trim()};}
 function setBusy(busy){state.pending=busy;for(const id of ['qna-compose-dialog','qna-thread-dialog','qna-confirm-dialog']){const node=$('#'+id);node.setAttribute('aria-busy',busy);$$('button,input,textarea,select',node).forEach(control=>{if(busy){control.dataset.qnaWasDisabled=control.disabled?'yes':'no';control.disabled=true;}else if(control.dataset.qnaWasDisabled){control.disabled=control.dataset.qnaWasDisabled==='yes';delete control.dataset.qnaWasDisabled;}});}renderStatus();}
 async function post(payload,key){
  if(!state.configured||!state.canWrite||state.loading)throw Error(statusText());
  const token=ownerKey();let response,data;
  try{response=await fetch('/api/qna',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-QNA-Owner':token},body:JSON.stringify({...payload,requestId:requestId(key),website:payload.website||''})});}catch{throw Error('연결이 끊겨 저장 결과를 확인하지 못했습니다. 입력 내용은 유지했습니다. 새로고침 후 확인하거나 같은 내용으로 다시 시도해주세요.');}
  try{data=await response.json();}catch{throw Error('서버 응답을 확인하지 못했습니다. 입력 내용은 유지했습니다. 잠시 후 다시 시도해주세요.');}
  if(!response.ok){if(data.configured===false||data.error?.code==='STORAGE_NOT_CONFIGURED'){state.configured=false;state.canWrite=false;}const message=plain(data.error?.message,800)||'공유 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';throw Error(message+(response.status===409?' 입력 내용은 유지했습니다. 최신 글을 확인한 뒤 다시 수정해주세요.':''));}
  requestIds.delete(key);return data;
 }
 function applyResponse(data){searchCache.clear();const q=normalizeQuestion(data.question);if(q){const index=state.questions.findIndex(value=>value.id===q.id);if(index>=0)state.questions[index]=q;else state.questions.unshift(q);}if(questionID(data.deletedQuestionId))state.questions=state.questions.filter(value=>value.id!==data.deletedQuestionId);return q;}
 async function submitForm(form){
  if(state.pending)return;const values=formValues(form),key=draftKey(form),action=form.dataset.qnaForm,requestKey=actionKey(form),error=$('.qna-form-error',form);drafts.set(key,values);error.hidden=true;
  let payload;try{
   if(action==='create-question'||action==='update-question'){payload={action,question:prepareQuestion(values),website:String(values.website||'')};if(action==='update-question'){payload.questionId=form.dataset.qnaQuestionId;payload.expectedVersion=state.compose?.version;}}
   else {const body=String(values.body||'').trim();if(!body)throw Error('답변 내용을 입력해주세요.');payload={action,questionId:form.dataset.qnaQuestionId,answer:{body,author:String(values.author||'').trim()}};if(action==='update-answer'){payload.answerId=form.dataset.qnaAnswerId;payload.expectedVersion=state.editAnswer?.version;}}
   if(!canWrite())throw Error(statusText());
   // Validate and persist the browser ownership key before disabling the form.
   ownerKey();setBusy(true);const data=await post(payload,requestKey);const q=applyResponse(data);state.author=String(values.author||'').trim();
   if(action==='create-question'&&q&&!ownsQuestion(q.id))owned.questions.push(q.id);
   if(action==='create-answer'&&q){const created=data.createdAnswerId||data.answerId;if(answerID(created)&&q.answers.some(a=>a.id===created)&&!ownsAnswer(created))owned.answers.push(created);}
   saveOwned();drafts.delete(key);setBusy(false);
   if(action==='create-question'||action==='update-question'){closeCompose();if(q)openQuestion(q.id);}else{state.editAnswer=null;renderThread();}
   render();notify();notice(action.startsWith('create')?'공유 저장소에 등록했습니다.':'수정 내용을 저장했습니다.');
  }catch(failure){setBusy(false);displayError(error,failure.message);renderStatus();}
 }
 function confirmDelete(kind,id){
  if(!canWrite())return notice(statusText());const q=question(state.selectedId),a=q?.answers.find(v=>v.id===id);if(kind==='question'&&(!q||!ownsQuestion(q.id)))return;if(kind==='answer'&&(!a||!ownsAnswer(a.id)))return;
  if(kind==='question'&&q.answers.length)return notice('답변이 있는 질문은 삭제할 수 없습니다.');
  state.confirm={kind,id,questionId:q.id,version:kind==='question'?q.version:a.version};
  $('#qna-confirm-body').innerHTML=`<h2 id="qna-confirm-title">${kind==='question'?'질문을':'내 답변을'} 삭제할까요?</h2><p>공유 목록에서 삭제되며 다시 복구할 수 없습니다.${kind==='question'?' 답변이 없는 내 질문만 삭제할 수 있습니다.':''}</p>${errorBox('qna-delete-error')}<div class="qna-confirm-actions"><button type="button" class="secondary-button" data-qna-cancel-delete>취소</button><button type="button" class="qna-danger-button" id="qna-confirm-delete">삭제</button></div>`;$('#qna-confirm-dialog').showModal();
 }
 async function deleteConfirmed(){
  if(state.pending||!state.confirm)return;const c=state.confirm,key='delete-'+c.kind+':'+c.id;
  try{ownerKey();setBusy(true);const data=await post({action:'delete-'+c.kind,questionId:c.questionId,...(c.kind==='answer'?{answerId:c.id}:{}),expectedVersion:c.version},key);applyResponse(data);if(c.kind==='question')owned.questions=owned.questions.filter(v=>v!==c.id);else owned.answers=owned.answers.filter(v=>v!==c.id);saveOwned(c.kind==='question'?{questions:[c.id]}:{answers:[c.id]});setBusy(false);$('#qna-confirm-dialog').close();state.confirm=null;if(c.kind==='question')closeThread();else renderThread();render();notify();notice('공유 목록에서 삭제했습니다.');}catch(failure){setBusy(false);displayError($('#qna-delete-error'),failure.message);renderStatus();}
 }
 async function refresh({announce=false}={}){
  if(state.pending){notice('저장 중입니다. 잠시 기다려주세요.');return;}
  if(inflight)return inflight;
  state.loading=true;state.loadError='';render();
  inflight=(async()=>{
   try{
    if(location.protocol==='file:'){state.configured=false;state.canWrite=false;state.loadError='공유 질문·답변은 배포된 웹페이지에서 이용할 수 있습니다. 파일 안에 질문을 저장하지 않습니다.';return;}
    const response=await fetch('/api/qna',{credentials:'same-origin',cache:'no-store'});const data=await response.json();
    if(data.configured===false){state.configured=false;state.canWrite=false;state.loadError=plain(data.error?.message,800)||'공유 저장소 연결을 준비하고 있습니다.';return;}
    if(!response.ok||data.configured!==true||!Array.isArray(data.questions))throw Error('공유 질문 목록을 불러오지 못했습니다.');
    state.configured=true;state.canWrite=data.canWrite===true;state.questions=data.questions.map(normalizeQuestion).filter(Boolean);searchCache.clear();if(announce)notice('공유 질문 목록을 새로 불러왔습니다.');
   }catch{state.canWrite=false;state.loadError='공유 질문 목록을 불러오지 못했습니다. 잠시 후 새로고침해주세요.';}
   finally{state.loading=false;inflight=null;render();if(state.selectedId&&$('#qna-thread-dialog').open&&!state.pending)renderThread();notify();const id=new URLSearchParams(location.hash.slice(1)).get('qna');if(id&&!state.selectedId)openQuestion(id);}
  })();return inflight;
 }
 async function copyLink(id){
  if(!/^https?:$/.test(location.protocol)){notice('배포된 웹페이지에서 질문 링크를 공유할 수 있습니다.');return;}
  const url=new URL(location.href);url.search='';url.hash='qna='+id;
  try{await navigator.clipboard.writeText(url.href);notice('질문 링크를 복사했습니다.');}catch{const area=document.createElement('textarea');area.className='sr-only';area.value=url.href;$('#qna-thread-dialog').append(area);area.focus();area.select();let ok=false;try{ok=document.execCommand('copy');}catch{}area.remove();notice(ok?'질문 링크를 복사했습니다.':'링크 복사가 제한됩니다. 브라우저 주소의 질문 링크를 직접 복사해주세요.');}
 }
 function bind(){
  $('#qna-category').innerHTML='<option value="">모든 분류</option>'+categories.map(c=>`<option>${esc(c)}</option>`).join('');
  $('#qna-category').addEventListener('change',event=>{state.category=event.target.value;renderList();});
  document.addEventListener('click',event=>{
   const b=event.target.closest('button');if(!b)return;
   if(b.id==='qna-nav'||b.id==='qna-global-open'){open();window.scrollTo({top:0,behavior:'smooth'});$('#qna-title').focus({preventScroll:true});}
   else if(b.dataset.qnaView){state.view=b.dataset.qnaView;renderList();}
   else if(b.dataset.qnaOpen)openQuestion(b.dataset.qnaOpen,b);
   else if(b.dataset.qnaQuery!==undefined)searchFor(b.dataset.qnaQuery);
   else if(b.id==='qna-create'||b.hasAttribute('data-qna-create'))openCompose(null,b);
   else if(b.id==='qna-refresh'||b.hasAttribute('data-qna-refresh'))refresh({announce:true});
   else if(b.id==='qna-clear-query')searchFor('');
   else if(b.hasAttribute('data-qna-reset')){state.category='';state.view='all';$('#qna-category').value='';searchFor('');renderList();}
   else if(b.hasAttribute('data-qna-close-thread'))closeThread();
   else if(b.hasAttribute('data-qna-close-compose'))closeCompose();
   else if(b.dataset.qnaShare)copyLink(b.dataset.qnaShare);
   else if(b.dataset.qnaEditQuestion)openCompose(b.dataset.qnaEditQuestion,b);
   else if(b.dataset.qnaDeleteQuestion)confirmDelete('question',b.dataset.qnaDeleteQuestion);
   else if(b.dataset.qnaDeleteAnswer)confirmDelete('answer',b.dataset.qnaDeleteAnswer);
   else if(b.dataset.qnaEditAnswer){const q=question(state.selectedId),a=q?.answers.find(v=>v.id===b.dataset.qnaEditAnswer);if(a&&ownsAnswer(a.id)&&canWrite()){state.editAnswer={id:a.id,version:a.version};renderThread();$('#qna-edit-answer-body').focus();}}
   else if(b.hasAttribute('data-qna-cancel-answer')){state.editAnswer=null;renderThread();}
   else if(b.hasAttribute('data-qna-cancel-delete')){$('#qna-confirm-dialog').close();state.confirm=null;}
   else if(b.id==='qna-confirm-delete')deleteConfirmed();
  });
  document.addEventListener('input',event=>{const form=event.target.closest('form[data-qna-form]');if(!form)return;drafts.set(draftKey(form),formValues(form));requestIds.delete(actionKey(form));});
  document.addEventListener('submit',event=>{const form=event.target.closest('form[data-qna-form]');if(!form)return;event.preventDefault();submitForm(form);});
  $('#qna-tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=$$('[role="tab"]',$('#qna-tabs')),i=tabs.indexOf(event.target);if(i<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;state.view=tabs[next].dataset.qnaView;renderList();tabs[next].focus();});
  $('#qna-thread-dialog').addEventListener('cancel',event=>{event.preventDefault();closeThread();});$('#qna-compose-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCompose();});$('#qna-confirm-dialog').addEventListener('cancel',event=>{if(state.pending)event.preventDefault();else state.confirm=null;});
  window.addEventListener('hashchange',()=>{const id=new URLSearchParams(location.hash.slice(1)).get('qna');if(id&&id!==state.selectedId)openQuestion(id);else if(!id&&state.selectedId&&!state.pending){$('#qna-thread-dialog').close();state.selectedId=null;state.editAnswer=null;}});
  window.addEventListener('storage',event=>{if(event.key===ownedName||event.key===null){owned=readOwned();render();if(state.selectedId&&$('#qna-thread-dialog').open&&!state.pending)renderThread();}});
 }
 function init(settings={}){options={...options,...settings};searchCache.clear();if(state.initialized)return api;state.initialized=true;bind();render();refresh();const id=new URLSearchParams(location.hash.slice(1)).get('qna');if(id)openQuestion(id);return api;}
 const api=Object.freeze({init,setQuery,close,closeDialogs,isOpen:()=>state.open,countMatches:query=>matching(query).length,suggest:query=>matching(query).slice(0,3).map(({question:q})=>({text:q.title,label:'상담사 QnA',type:'qna'}))});
 window.GuideQnA=api;
})();
