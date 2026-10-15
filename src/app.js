/* Browser-local counselor workspace. Search text never leaves memory. */
(() => {
 'use strict';
 const $=(q,base=document)=>base.querySelector(q),$$=(q,base=document)=>[...base.querySelectorAll(q)];
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const iconPaths={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',bill:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4"/>',book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1zM12 5v15"/>',settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',tool:'<path d="M14 6a5 5 0 0 0-6 6l-5 5a2.1 2.1 0 0 0 3 3l5-5a5 5 0 0 0 6-6l-3 3-3-3z"/>',chat:'<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0zM7 10h10M7 14h7"/>',user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C5 8 5 2 8 3c3 0 4 5 4 5s1-5 4-5c3-1 3 5-4 5z"/>',business:'<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12h18M10 12v3h4v-3"/>',search:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/>',arrow:'<path d="M4 12h16m-5-5 5 5-5 5"/>',copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',home:'<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-8h6v8"/>',phone:'<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M10 18h4"/>',check:'<path d="m5 12 4 4L19 6"/>',lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',zoom:'<path d="M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5"/>',link:'<path d="m10 13 4-4M7 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0M13 8l1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',print:'<path d="M6 8V3h12v5M6 17H3V8h18v9h-3M6 14h12v7H6zM17 11h1"/>'};
 const icon=name=>`<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name]||iconPaths.book}</svg>`;
 const categoryIcons={'전체 기능':'grid','요금·납부':'bill','가입·상품':'book','이용·변경':'settings','장애·A/S':'tool','문의·고객지원':'chat','회원·계정':'user','혜택·콘텐츠':'gift','사업자 지원':'business'};
 const categoryOrder=Object.keys(categoryIcons).slice(1);
 const defaults=()=>({q:'',major:'',middle:'',minor:'',product:'',login:'',availability:'',action:'',view:'all',sort:'recommended'});
 let state=defaults(),features=[],allowedHosts=new Set(),engine=null,selected=null,trigger=null,toastTimer,debounce,suggestions=[],suggestionIndex=-1,lastResult=null;
 const queryText=value=>String(value??'').slice(0,500);
 const savedKey='skylife-guide:saved',recentKey='skylife-guide:recent';
 function storedIDs(key){try{const value=JSON.parse(localStorage.getItem(key)||'[]');return Array.isArray(value)?value.filter(v=>typeof v==='string'&&/^f-[a-z0-9-]+$/i.test(v)).slice(0,100):[];}catch{return [];}}
 let saved=new Set(storedIDs(savedKey)),recent=storedIDs(recentKey);
 function storeIDs(key,ids){try{localStorage.setItem(key,JSON.stringify(ids));}catch{toast('이 브라우저에서는 기록 저장이 제한됩니다.');}}
 function toast(message){$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3000);}
 function safeURL(value){try{const url=new URL(value);return url.protocol==='https:'&&allowedHosts.has(url.hostname)&&!url.username&&!url.password&&!url.port?url.href:'#';}catch{return '#';}}
 function safeImage(value){const src=String(value||'');return /^(?:screens|assets)\/[a-zA-Z0-9_./-]+\.(?:jpe?g|png|webp)$/.test(src)&&!src.split('/').includes('..')||/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src)?src:'';}
 function availability(f){return f.availability||{mode:f.external?'external':f.action==='조회'?'lookup':['신청','변경','납부','등록','구매'].includes(f.action)?'action':'guide',label:f.external?'외부 서비스':f.action==='조회'?'조회':['신청','변경','납부','등록','구매'].includes(f.action)?'신청·변경':'정보 안내'};}
 function screenInfo(f){return {source:['소스 기반 예시','실제 화면 소스와 가상 데이터로 구성한 예시입니다.'],authenticated:['인증 후 실제 화면','테스트 계정 화면의 개인정보를 가린 캡처입니다.'],live:['실제 화면 캡처','공개 홈페이지에서 확인한 화면입니다.'],login:['로그인 진입 화면','로그인 이후의 상세 화면은 포함하지 않습니다.'],unavailable:['화면 확인 필요','현재 화면 캡처가 준비되지 않았습니다.']}[f.screen?.kind]||['화면 예시','메뉴와 화면은 현재 홈페이지에서 확인해주세요.'];}
 function highlight(value,terms=[]){
  const text=String(value??''),lower=text.toLocaleLowerCase('ko'),ranges=[];
  const keywords=[...new Set([...terms,...(state.q.trim().length<50?[state.q.trim()]:[])])].filter(t=>typeof t==='string'&&t.length>0&&t.length<100).slice(0,15);
  for(const term of keywords){const needle=term.toLocaleLowerCase('ko');let start=0,index;while((index=lower.indexOf(needle,start))!==-1){ranges.push([index,index+needle.length]);start=index+needle.length;}}
  ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);const merged=[];for(const range of ranges){const last=merged.at(-1);if(last&&range[0]<=last[1])last[1]=Math.max(last[1],range[1]);else merged.push([...range]);}
  let output='',cursor=0;for(const [start,end]of merged){output+=esc(text.slice(cursor,start))+'<mark>'+esc(text.slice(start,end))+'</mark>';cursor=end;}return output+esc(text.slice(cursor));
 }
 function updateHash(){
  // Only a catalog ID enters the URL. Free-text customer questions stay in memory.
  const url=new URL(location.href);url.hash=selected?'guide='+encodeURIComponent(selected.id):'';
  try{history.replaceState(null,'',url.href);}catch{if(selected)location.hash='guide='+encodeURIComponent(selected.id);}
 }
 function shareLink(id){
  const value=location.href;if(!value)return null;
  try{const url=new URL(value);if(!/^https?:$/.test(url.protocol))return null;url.search='';url.hash='guide='+id;return url.href;}catch{return null;}
 }
 async function copy(text){
  try{await navigator.clipboard.writeText(text);toast('복사했습니다.');return true;}catch{
   const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.className='sr-only';
   const host=$('#image-dialog').open?$('#image-dialog'):$('#guide-dialog').open?$('#guide-dialog'):document.body;
   const focused=document.activeElement;host.append(area);area.focus();area.select();let ok=false;try{ok=document.execCommand('copy');}catch{}area.remove();focused?.focus({preventScroll:true});
   toast(ok?'복사했습니다.':'복사가 제한됩니다. 안내 문구를 직접 선택해 복사해주세요.');return ok;
  }
 }
 function filterValues(){return Object.fromEntries(['major','middle','minor','product','login','availability','action'].filter(k=>state[k]).map(k=>[k,state[k]]));}
 function updateSelect(selector,values,value,placeholder){const select=$(selector);select.innerHTML=`<option value="">${esc(placeholder)}</option>`+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');select.value=value;}
 function renderNav(){
  $('#category-nav').innerHTML=['전체 기능',...categoryOrder].map(name=>{
   const major=name==='전체 기능'?'':name,active=major===state.major&&state.view==='all',count=features.filter(f=>!major||f.major===major).length;
   const middle=major&&major===state.major?[...new Set(features.filter(f=>f.major===major).map(f=>f.middle))].sort((a,b)=>a.localeCompare(b,'ko')):[];
   return `<button class="nav-item ${active?'active':''}" data-major="${esc(major)}" ${active?'aria-current="page"':''}>${icon(categoryIcons[name])}<span>${esc(name)}</span><span class="nav-count">${count}</span></button>${middle.length?`<div class="nav-sub">${middle.map(value=>`<button data-middle="${esc(value)}" class="${state.middle===value?'active':''}" ${state.middle===value?'aria-current="true"':''}>${esc(value)}</button>`).join('')}</div>`:''}`;
  }).join('');
 }
 function renderFilters(){
  const base=features.filter(f=>!state.major||f.major===state.major);
  updateSelect('#middle-filter',[...new Set(base.map(f=>f.middle))].sort((a,b)=>a.localeCompare(b,'ko')),state.middle,'전체 중분류');
  updateSelect('#minor-filter',[...new Set(base.filter(f=>!state.middle||f.middle===state.middle).map(f=>f.minor))].sort((a,b)=>a.localeCompare(b,'ko')),state.minor,'전체 소분류');
  for(const key of ['product','login','availability'])$('#'+key+'-filter').value=state[key];$('#sort').value=state.sort;
  const actions=[...new Set(features.map(f=>f.action))].sort((a,b)=>a.localeCompare(b,'ko'));
  $('#purpose-filters').innerHTML=[['','전체'],...actions.map(v=>[v,v])].map(([value,label])=>`<button data-action="${esc(value)}" aria-pressed="${state.action===value}">${esc(label)}</button>`).join('');
  const labels={major:state.major,middle:state.middle,minor:state.minor,product:state.product,login:state.login==='required'?'로그인 필요':state.login==='public'?'로그인 외 진입':'',availability:{action:'신청·변경',lookup:'조회',guide:'정보 안내',external:'외부 서비스'}[state.availability],action:state.action};
  $('#active-filters').innerHTML=Object.entries(labels).filter(([,v])=>v).map(([key,value])=>`<button class="active-chip" data-clear="${key}" aria-label="${esc(value)} 필터 해제">${esc(value)}<span aria-hidden="true">×</span></button>`).join('');
 }
 function renderView(){
  $$('[data-view]').forEach(b=>{const on=b.dataset.view===state.view;b.classList.toggle('selected',on);if(b.getAttribute('role')==='tab'){b.setAttribute('aria-selected',on);b.tabIndex=on?0:-1;}});
  $('#cards').setAttribute('aria-labelledby','tab-'+state.view);$('#saved-count').textContent=saved.size;$('#sidebar-saved-count').textContent=saved.size;$('#sidebar-recent-count').textContent=recent.length;
  const title=state.view==='saved'?'즐겨찾기':state.view==='recent'?'최근 본 기능':state.major||'전체 기능';
  $('#list-title').firstChild.textContent=title+' ';$('#total-count').textContent=state.view==='saved'?saved.size:state.view==='recent'?recent.length:features.filter(f=>!state.major||f.major===state.major).length;
 }
 function render(){
  if(!engine)return;
  renderNav();renderFilters();renderView();$('#search').value=state.q;$('#clear-search').hidden=!state.q;
  $('#scenario-section').hidden=Boolean(state.q)||state.view!=='all';
  const response=engine.search(state.q,filterValues());lastResult=response;
  let items=response.items.filter(({feature:f})=>(state.view!=='saved'||saved.has(f.id))&&(state.view!=='recent'||recent.includes(f.id)));
  if(state.view==='recent'&&!state.q)items.sort((a,b)=>recent.indexOf(a.feature.id)-recent.indexOf(b.feature.id));
  else if(state.sort==='name')items.sort((a,b)=>a.feature.title.localeCompare(b.feature.title,'ko'));
  else if(state.sort==='category')items.sort((a,b)=>(a.feature.major+a.feature.middle+a.feature.title).localeCompare(b.feature.major+b.feature.middle+b.feature.title,'ko'));
  const displayQuery=state.q.length>72?state.q.slice(0,72)+'…':state.q;
  $('#result-summary').innerHTML=state.q?`‘<strong>${esc(displayQuery)}</strong>’ 검색 결과 <strong>${items.length}</strong>개`:`<strong>${items.length}</strong>개 기능 ${state.view==='recent'?'· 최근 확인한 순서로 보여드려요':'· 필요한 가이드를 선택하세요'}`;
  const context=$('#search-context');context.hidden=true;context.innerHTML='';
  if(state.q&&response.intent?.unsupported){context.hidden=false;context.innerHTML=`${icon('chat')}<span>홈페이지에서 가능한 조치는 기능별 이용 조건을 확인해주세요. ${esc(response.intent.label||'가까운 안내 기능을 찾아봤어요.')}</span>`;}
  else if(state.q&&response.correction){context.hidden=false;context.innerHTML=`<span>비슷한 검색어: </span><button data-query="${esc(response.correction)}">${esc(response.correction)}</button><span>· 입력한 질문과 함께 확인했어요.</span>`;}
  else if(state.q&&response.lowConfidence&&items.length){context.hidden=false;context.innerHTML='<span>가까운 기능을 찾았어요. 상품·처리 유형이 고객의 상황과 맞는지 확인해주세요.</span>';}
  $('#cards').innerHTML=items.map((item,index)=>cardHTML(item,index)).join('');$('#cards').setAttribute('aria-busy','false');
  $('#empty-state').hidden=items.length>0;if(!items.length)renderEmpty(response);
 }
 function cardHTML({feature:f,reason,matchedTerms=[]},index){
  const type=availability(f),screen=screenInfo(f),showReason=state.q&&reason;
  return `<article class="card ${state.q&&index<2?'is-best':''}" data-feature="${esc(f.id)}"><button class="bookmark ${saved.has(f.id)?'saved':''}" data-save="${esc(f.id)}" aria-pressed="${saved.has(f.id)}" aria-label="${esc(f.title)} 즐겨찾기 ${saved.has(f.id)?'해제':'추가'}">${icon('bookmark')}</button><button class="card-open" data-open="${esc(f.id)}"><div class="card-category">${esc(f.major)}<span aria-hidden="true">›</span>${esc(f.middle)}</div><h3>${highlight(f.title,matchedTerms)}</h3><p>${highlight(f.summary,matchedTerms)}</p><div class="card-menu" title="${esc(f.menu.join(' › '))}">${esc(f.menu.join(' › '))}</div><div class="card-tags"><span class="pill product">${esc(f.product)}</span><span class="pill ${type.mode==='action'?'action':''}">${esc(type.label)}</span><span class="pill ${f.login?'login':''}">${f.login?'로그인 필요':'로그인 외 진입'}</span></div>${showReason?`<div class="match-reason">${icon('search')}<span>${esc(reason)}</span></div>`:''}</button><div class="card-bottom"><span>${esc(screen[0])}</span><button data-open="${esc(f.id)}">가이드 보기 ${icon('arrow')}</button></div></article>`;
 }
 function renderEmpty(response){
  const hasFilters=Object.keys(filterValues()).length>0,personal=state.view!=='all';
  const title=state.view==='saved'&&!state.q&&!hasFilters?'즐겨찾기에 담은 기능이 없어요.':state.view==='recent'&&!state.q&&!hasFilters?'최근에 본 기능이 없어요.':'이 조건에서 일치하는 기능을 찾지 못했어요.';
  const description=personal&&!state.q&&!hasFilters?'전체 기능에서 가이드를 열거나 즐겨찾기 버튼을 선택해보세요.':hasFilters?'검색어는 유지한 채 분류·상품·인증 조건의 범위를 넓혀보세요.':'질문을 짧게 바꾸거나 아래 고객 표현으로 다시 찾아보세요.';
  const suggestions=(response.suggestions?.length?response.suggestions:['이사','미납요금','TV 안 나옴']).slice(0,4);
  $('#empty-state').innerHTML=`<span class="empty-symbol">${icon('search')}</span><h3>${esc(title)}</h3><p>${esc(description)}</p><div class="empty-actions">${hasFilters||personal?'<button class="primary-button" data-widen>검색어 유지하고 범위 넓히기</button>':''}<button class="${hasFilters||personal?'secondary':'primary'}-button" data-reset>전체 기능 보기</button></div><div class="suggestions">${suggestions.map(q=>`<button data-query="${esc(q)}">${esc(q)}</button>`).join('')}</div>`;
 }
 function relatedFeatures(f){
  const row=engine.search(f.title,{}).items.map(v=>v.feature).filter(r=>r.id!==f.id);
  const same=features.filter(r=>r.id!==f.id&&(r.major===f.major&&r.middle===f.middle||r.aliases.some(a=>f.aliases.includes(a))));
  return [...new Map([...same,...row].map(v=>[v.id,v])).values()].slice(0,4);
 }
 function guideHTML(f){
  const screen=f.screen,type=availability(f),screenLabel=screenInfo(f),related=relatedFeatures(f),hasScreen=safeImage(screen?.src)&&screen.kind!=='unavailable';
  return `<header class="guide-head"><button class="icon-button guide-close" id="guide-close" aria-label="기능 가이드 닫기">✕</button><div class="guide-meta">${esc(f.major)}<span aria-hidden="true">›</span>${esc(f.middle)}<span aria-hidden="true">›</span>${esc(f.minor)}</div><h2 id="guide-title">${esc(f.title)}</h2><p>${esc(f.summary)}</p><div class="guide-tags"><span class="pill product">${esc(f.product)}</span><span class="pill ${type.mode==='action'?'action':''}">${esc(type.label)}</span><span class="pill ${f.login?'login':''}">${f.login?'로그인 필요':'로그인 외 진입'}</span><span class="pill">${esc(f.action)}</span></div></header><div class="guide-toolbar"><a class="primary-button" href="${esc(safeURL(f.url))}" target="_blank" rel="noopener noreferrer">홈페이지 바로가기 <span aria-hidden="true">↗</span><span class="sr-only"> 새 창</span></a><button class="secondary-button" id="share-guide">${icon('link')}가이드 링크 복사</button><button class="secondary-button" id="print-guide">${icon('print')}인쇄</button><button class="secondary-button guide-save ${saved.has(f.id)?'saved':''}" id="guide-save" data-save="${esc(f.id)}" aria-pressed="${saved.has(f.id)}" aria-label="${esc(f.title)} 즐겨찾기 ${saved.has(f.id)?'해제':'추가'}">${icon('bookmark')}<span>${saved.has(f.id)?'저장됨':'즐겨찾기'}</span></button></div><div class="guide-content"><section class="instruction-section"><h3><span><span class="section-number">01</span>안내 전 확인</span></h3><div class="precheck"><div class="precheck-row">${icon(f.login?'lock':'check')}<div><strong>${f.login?'홈페이지 로그인 필요':'로그인 외 진입 가능'}</strong><p>${f.login?'고객이 직접 로그인한 뒤 가입상품과 이용 가능 여부를 확인합니다.':'상세 신청이나 본인 확인 단계에서는 추가 인증이 필요할 수 있습니다.'}</p></div></div><div class="precheck-row">${icon('settings')}<div><strong>${esc(f.product)} · ${esc(type.label)}</strong><p>${type.mode==='external'?'연결된 외부 서비스의 절차와 이용 조건을 확인합니다.':'가입상태·고객 유형에 따른 실제 제공 범위는 현재 홈페이지를 확인합니다.'}</p></div></div></div><div class="note-box"><strong>고객 안내 전, 꼭 확인하세요</strong>${esc(f.note)}</div><h3><span><span class="section-number">02</span>홈페이지 메뉴 경로</span></h3><div class="menu-path">${f.menu.map(esc).join('<span aria-hidden="true">›</span>')}<button id="copy-path" aria-label="홈페이지 메뉴 경로 복사">${icon('copy')}</button></div><h3><span><span class="section-number">03</span>고객 조치 순서</span></h3><ol class="steps">${f.login?'<li>고객이 홈페이지에 로그인한 뒤 이용할 가입상품 또는 고객 정보를 확인합니다.</li>':''}${f.steps.map(step=>`<li>${esc(step)}</li>`).join('')}</ol><h3><span><span class="section-number">04</span>고객 안내 문구</span><button class="copy-script" id="copy-script">${icon('copy')}문구 복사</button></h3><div class="script-box" tabindex="0">${esc(f.script)}</div></section><section class="screen-section"><h3>화면으로 확인<span class="screen-kind ${screen?.kind==='source'?'source':''}">${esc(screenLabel[0])}</span></h3><div class="screen-wrap"><div class="browser-bar"><i></i><i></i><i></i><span>${esc(screen?.url||f.url)}</span></div>${hasScreen?`<button class="screen-button" id="zoom-button" aria-label="${esc(f.title)} 화면 전체 확대"><img src="${esc(screen.src)}" alt="${esc(f.title)} · ${esc(screenLabel[0])}"><span>${icon('zoom')}화면 전체 보기</span></button>`:'<div class="screen-unavailable">화면 캡처가 준비되지 않았습니다.<br>현재 홈페이지에서 확인해주세요.</div>'}</div><p class="screen-caption">${screen?.kind==='source'?'<strong>실제 고객의 청구정보가 아닌 가상 데이터 예시입니다.</strong>':screen?.kind==='login'?'<strong>로그인 이후의 상세 화면이 아닌 로그인 진입 화면입니다.</strong>':''}${esc(screen?.caption||screenLabel[1])}</p><div class="screen-date"><span>화면 확인 ${esc(screen?.captured||'확인 필요')}</span>${hasScreen?'<span>이미지를 누르면 전체 확대</span>':''}</div><p class="screen-disclaimer">이 화면은 메뉴 위치와 절차를 설명하기 위한 참고자료입니다. 요금·일정·제공 조건과 고객별 상세정보는 현재 홈페이지를 기준으로 안내해주세요.</p></section></div>${related.length?`<section class="related"><h3>함께 확인하면 좋은 기능</h3><div class="related-buttons">${related.map(r=>`<button data-open="${esc(r.id)}"><span>${esc(r.title)}<small>${esc(r.major)} · ${esc(availability(r).label)}</small></span>${icon('arrow')}</button>`).join('')}</div></section>`:''}`;
 }
 function openGuide(id,opener){
  const f=features.find(feature=>feature.id===id);if(!f)return;
  if(opener)trigger=opener;selected=f;closeSuggestions();setMenu(false);
  recent=[id,...recent.filter(value=>value!==id)].slice(0,20);storeIDs(recentKey,recent);renderView();
  $('#guide-body').innerHTML=guideHTML(f);if(!$('#guide-dialog').open)$('#guide-dialog').showModal();$('#guide-dialog').scrollTop=0;updateHash();
 }
 function closeGuide(){
  const id=selected?.id;selected=null;$('#guide-dialog').close();updateHash();if(state.view==='recent')render();
  const focus=trigger?.isConnected?trigger:document.querySelector(`[data-open="${CSS.escape(id||'')}"]`);focus?.focus({preventScroll:true});trigger=null;
 }
 function toggleSave(id){
  saved.has(id)?saved.delete(id):saved.add(id);storeIDs(savedKey,[...saved]);render();
  if(selected?.id===id){const b=$('#guide-save');b.classList.toggle('saved',saved.has(id));b.setAttribute('aria-pressed',saved.has(id));b.setAttribute('aria-label',selected.title+' 즐겨찾기 '+(saved.has(id)?'해제':'추가'));$('span',b).textContent=saved.has(id)?'저장됨':'즐겨찾기';}
  else {const target=document.querySelector(`[data-save="${CSS.escape(id)}"]`)||$('#tab-saved');target.focus({preventScroll:true});}
  toast(saved.has(id)?'즐겨찾기에 저장했습니다.':'즐겨찾기에서 해제했습니다.');
 }
 function reset(){clearTimeout(debounce);state=defaults();closeSuggestions();render();}
 function widen(){clearTimeout(debounce);const q=state.q;state=defaults();state.q=q;render();}
 function setQuery(q,clear=false){clearTimeout(debounce);if(clear)state=defaults();state.q=queryText(q);closeSuggestions();render();$('#search').focus({preventScroll:true});closeSuggestions();}
 function setMenu(open){const mobile=matchMedia('(max-width:700px)').matches;$('#sidebar').classList.toggle('open',open);$('#menu-backdrop').hidden=!open;$('#mobile-menu').setAttribute('aria-expanded',open);$('.workspace').inert=open&&mobile;document.body.classList.toggle('menu-open',open&&mobile);if(open)$('#mobile-menu-close').focus();}
 function closeSuggestions(){suggestions=[];suggestionIndex=-1;$('#search-suggestions').hidden=true;$('#search').setAttribute('aria-expanded','false');$('#search').removeAttribute('aria-activedescendant');}
 function showSuggestions(){
  if(!engine||!$('#search').value.trim()){closeSuggestions();return;}
  suggestions=engine.suggest(queryText($('#search').value)).slice(0,7);suggestionIndex=-1;
  $('#search-suggestions').innerHTML=suggestions.map((v,i)=>`<li role="presentation"><button type="button" id="suggestion-${i}" role="option" aria-selected="false" data-suggestion="${i}" tabindex="-1"><span>${esc(v.text)}</span><small>${esc(v.label||'관련 검색어')}</small></button></li>`).join('');
  $('#search-suggestions').hidden=!suggestions.length;$('#search').setAttribute('aria-expanded',!!suggestions.length);$('#search').removeAttribute('aria-activedescendant');
 }
 function chooseSuggestion(index){const choice=suggestions[index];if(choice)setQuery(choice.text);}
 function updateSuggestionIndex(index){suggestionIndex=index;$$('[role="option"]',$('#search-suggestions')).forEach((node,i)=>node.setAttribute('aria-selected',i===index));$('#search').setAttribute('aria-activedescendant','suggestion-'+index);}
 for(const node of $$('[data-icon]'))node.innerHTML=icon(node.dataset.icon);
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-home]')){event.preventDefault();if(selected)closeGuide();reset();setMenu(false);window.scrollTo({top:0,behavior:'smooth'});return;}
  const b=event.target.closest('button');if(!b){if(!event.target.closest('.search-control'))closeSuggestions();return;}
  if(b.dataset.suggestion!==undefined){chooseSuggestion(Number(b.dataset.suggestion));return;}
  if(b.dataset.major!==undefined){state.major=b.dataset.major;state.middle='';state.minor='';state.view='all';render();setMenu(false);(matchMedia('(max-width:700px)').matches?$('#mobile-menu'):document.querySelector(`[data-major="${CSS.escape(state.major)}"]`))?.focus({preventScroll:true});}
  else if(b.dataset.middle!==undefined){state.middle=b.dataset.middle;state.minor='';render();setMenu(false);(matchMedia('(max-width:700px)').matches?$('#mobile-menu'):document.querySelector(`[data-middle="${CSS.escape(state.middle)}"]`))?.focus({preventScroll:true});}
  else if(b.dataset.view){state.view=b.dataset.view;render();}
  else if(b.dataset.action!==undefined){state.action=b.dataset.action;render();$('#purpose-filters button[data-action="'+CSS.escape(state.action)+'"]')?.focus({preventScroll:true});}
  else if(b.dataset.query!==undefined)setQuery(b.dataset.query,!!b.closest('.scenario-grid,.empty-state'));
  else if(b.dataset.open)openGuide(b.dataset.open,b);
  else if(b.dataset.save)toggleSave(b.dataset.save);
  else if(b.dataset.clear){const key=b.dataset.clear;state[key]='';if(key==='major'){state.middle='';state.minor='';}if(key==='middle')state.minor='';render();($('#'+key+'-filter')||$('#search')).focus({preventScroll:true});}
  else if(b.hasAttribute('data-widen'))widen();
  else if(b.hasAttribute('data-reset')||b.id==='reset')reset();
  else if(b.id==='guide-close')closeGuide();
  else if(b.id==='copy-script')copy(selected.script);
  else if(b.id==='copy-path')copy(selected.menu.join(' → '));
  else if(b.id==='share-guide'){const url=shareLink(selected.id);url?copy(url):toast('운영 웹페이지에서 기능별 링크를 공유해주세요.');}
  else if(b.id==='print-guide')window.print();
  else if(b.id==='zoom-button'){const f=selected;$('#zoom-image').src=safeImage(f.screen.src);$('#zoom-image').alt=f.title+' · '+screenInfo(f)[0];$('#zoom-title').textContent=f.title+' · 화면 전체 보기';$('#zoom-caption').textContent=f.screen.caption||'';$('#zoom-frame').classList.remove('original');$('#zoom-fit').setAttribute('aria-pressed','false');$('#zoom-fit').textContent='원본 크기';$('#image-dialog').showModal();}
  else if(b.id==='zoom-fit'){const original=$('#zoom-frame').classList.toggle('original');b.setAttribute('aria-pressed',original);b.textContent=original?'화면에 맞추기':'원본 크기';}
  else if(b.id==='zoom-close')$('#image-dialog').close();
  else if(['about-button','footer-about'].includes(b.id))$('#about-dialog').showModal();
  else if(b.id==='about-close')$('#about-dialog').close();
  else if(b.id==='mobile-menu')setMenu(!$('#sidebar').classList.contains('open'));
  else if(b.id==='mobile-menu-close'){setMenu(false);$('#mobile-menu').focus();}
  else if(b.id==='clear-search'){state.q='';$('#search').value='';closeSuggestions();render();$('#search').focus();}
  else if(b.hasAttribute('data-reload'))location.reload();
 });
 $('#menu-backdrop').addEventListener('click',()=>setMenu(false));
 $('#search-form').addEventListener('submit',event=>{event.preventDefault();clearTimeout(debounce);state.q=queryText($('#search').value);closeSuggestions();render();});
 $('#search').addEventListener('input',()=>{clearTimeout(debounce);const value=queryText($('#search').value);$('#clear-search').hidden=!value;showSuggestions();debounce=setTimeout(()=>{state.q=value;render();},180);});
 $('#search').addEventListener('focus',()=>{if($('#search').value.trim())showSuggestions();});
 $('#search').addEventListener('keydown',event=>{
  if(['ArrowDown','ArrowUp'].includes(event.key)){
   if(!suggestions.length)showSuggestions();if(suggestions.length){event.preventDefault();const next=event.key==='ArrowDown'?(suggestionIndex+1)%suggestions.length:(suggestionIndex-1+suggestions.length)%suggestions.length;updateSuggestionIndex(next);}
  }else if(event.key==='Enter'&&suggestionIndex>=0){event.preventDefault();clearTimeout(debounce);chooseSuggestion(suggestionIndex);}
  else if(event.key==='Escape'){closeSuggestions();event.stopPropagation();}
 });
 for(const key of ['middle','minor','product','login','availability'])$('#'+key+'-filter').addEventListener('change',event=>{state[key]=event.target.value;if(key==='middle')state.minor='';render();});
 $('#sort').addEventListener('change',event=>{state.sort=event.target.value;render();});
 $('.tabs').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const tabs=$$('[role="tab"]',$('.tabs')),index=tabs.indexOf(event.target);if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;state.view=tabs[next].dataset.view;render();tabs[next].focus();});
 document.addEventListener('keydown',event=>{
  if(event.key==='Tab'&&$('#sidebar').classList.contains('open')&&matchMedia('(max-width:700px)').matches){const nodes=$$('a[href],button:not(:disabled)',$('#sidebar')).filter(n=>n.getClientRects().length);const index=nodes.indexOf(document.activeElement);if(event.shiftKey&&index<=0){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&index===nodes.length-1){event.preventDefault();nodes[0]?.focus();}}
  if((event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName))||((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k')){event.preventDefault();if($('#image-dialog').open)$('#image-dialog').close();if($('#about-dialog').open)$('#about-dialog').close();if(selected)closeGuide();$('#search').focus();}
  if(event.key==='Escape'&&$('#sidebar').classList.contains('open')){setMenu(false);$('#mobile-menu').focus();}
 });
 window.addEventListener('resize',()=>{if(!matchMedia('(max-width:700px)').matches&&$('#sidebar').classList.contains('open'))setMenu(false);});
 $('#guide-dialog').addEventListener('cancel',event=>{event.preventDefault();closeGuide();});
 for(const id of ['guide-dialog','image-dialog','about-dialog'])$('#'+id).addEventListener('click',event=>{if(event.target!==event.currentTarget)return;const r=event.currentTarget.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)id==='guide-dialog'?closeGuide():event.currentTarget.close();});
 window.addEventListener('hashchange',()=>{const id=new URLSearchParams(location.hash.slice(1)).get('guide');if(id&&id!==selected?.id)openGuide(id);else if(!id&&selected)closeGuide();});
 async function jsonFile(name){const response=await fetch(name,{credentials:'same-origin',cache:'no-cache'});if(!response.ok)throw Error('기능 안내를 불러오지 못했습니다.');return response.json();}
 async function init(){
  try{
   const [catalog,dictionary]=await Promise.all([jsonFile('data.json'),jsonFile('search-dictionary.json')]);
   features=catalog.features;allowedHosts=new Set(catalog.allowedHosts||[]);saved=new Set([...saved].filter(id=>features.some(f=>f.id===id)));recent=recent.filter(id=>features.some(f=>f.id===id));
   engine=window.GuideSearch.createEngine(features,dictionary);$('#feature-count').textContent=features.length;
   if(catalog.updated){$('#catalog-updated').textContent=catalog.updated.replaceAll('-','.');$('#catalog-updated').dateTime=catalog.updated;}
   render();const id=new URLSearchParams(location.hash.slice(1)).get('guide');if(id)openGuide(id);
  }catch(error){$('#cards').setAttribute('aria-busy','false');$('#cards').innerHTML=`<div class="empty-state"><span class="empty-symbol">${icon('chat')}</span><h3>가이드북을 준비하지 못했어요.</h3><p>${esc(error.message)} 잠시 후 다시 시도해주세요.</p><button class="primary-button" data-reload>다시 불러오기</button></div>`;}
 }
 init();
})();
